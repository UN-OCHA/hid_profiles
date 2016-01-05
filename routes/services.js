var async = require('async'),
  _ = require('lodash'),
  google = require('googleapis'),
  googleAuth = require('google-auth-library'),
  mcapi = require('../node_modules/mailchimp-api/mailchimp'),
  log = require('../log'),
  roles = require('../lib/roles.js'),
  mail = require('../mail'),
  middleware = require('../middleware'),
  Service = require('../models').Service,
  ServiceCredentials = require('../models').ServiceCredentials,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact;

// Middleware function to grant/deny access to the put and delete routes
function putdelAccess(req, res, next) {
  async.series([
    function (cb) {
      middleware.require.access(req, res, cb);
    },
    function (cb) {
      if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
        return cb();
      }
      if (req.apiAuth.userProfile) {
        if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && (roles.has(req.apiAuth.userProfile, 'admin') || roles.has(req.apiAuth.userProfile, 'manager'))) {
          return cb();
        }
        else {
          Service
            .findById(req.params.id)
            .populate('owners')
            .exec(function (err, service) {
            if (err) {
              res.send(500, new Error(err));
              return cb(false);
            }
            if (!service) {
              res.send(404, new Error('Service ' + req.params.id + ' not found'));
              return cb(false);
            }
            if (service.userid != req.apiAuth.userId) {
              res.send(403, new Error('You are not allowed to do this'));
              return cb(false);
            }
            // check if user owns the service
            if (service.owners) {
              var owner = service.owners.filter(function (elt) {
                if (elt.userid === req.apiAuth.userId) {
                  return elt;
                }
              });
              if (!owner.length) {
                res.send(403, new Error('You are not allowed to do this'));
                return cb(false);
              }
            }
            else {
              return cb();
            }
          });
        }
      }
    }], function (err) {
      if (err) {
        return next(false);
      }
      next();
    });
}

function postAccess(req, res, next) {
  async.series([
    function (cb) {
      middleware.require.access(req, res, cb);
    },
    function (cb) {
      if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
        return cb();
      }
      if (req.apiAuth.userProfile) {
        if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && (roles.has(req.apiAuth.userProfile, 'admin') || roles.has(req.apiAuth.userProfile, 'manager'))) {
          return cb();
        }
        else {
          res.send(403, new Error('You are not allowed to do this'));
          return cb(false);
        }
      }
    }], function (err) {
      if (err) {
        return next(false);
      }
      next();
    }
  );
}

function managerAllowedLocations(req, service) {
  if (req.apiAuth.mode !== 'client' && !roles.has(req.apiAuth.userProfile, 'admin') && service.locations.length > 0) {
    // Check the locations to make sure the user has the right to add them
    var managerLocs = [];
    req.apiAuth.userProfile.roles.forEach(function (val) {
      managerLocs.push(val.replace('manager:', ''));
    });
    var invalid = service.locations.filter(function (loc) {
      var valid = false;
      for (var i = 0; i < managerLocs.length; i++) {
        if (loc.remote_id === managerLocs[i]) {
          valid = true;
        }
      }
      if (!valid) return loc;
    });
    return invalid.length ? false : true;
  }
  else {
    return true;
  }
}

// Helper function to verify integrity of data provided to put and post
function verifyService(req, res, cb) {
  if (!managerAllowedLocations(req, req.body)) {
    res.send(400, new Error('Invalid locations in your service'));
    return cb(true);
  }
  // If service is a google group, verify that it has a valid domain
  if (req.body.type === 'googlegroup') {
    if (!req.body.googlegroup || !req.body.googlegroup.domain) {
      res.send(400, new Error('No domain provided for google group'));
      return cb(true);
    }
    ServiceCredentials.findOne({type: 'googlegroup', 'googlegroup.domain': req.body.googlegroup.domain}, function (err, creds) {
      if (err) {
        res.send(500, new Error(err));
        return cb(true);
      }
      if (!creds) {
        res.send(400, new Error('Invalid domain provided for googlegroup'));
        return cb(true);
      }
      Service.findOne({status: true, type: 'googlegroup', 'googlegroup.domain': req.body.googlegroup.domain, 'googlegroup.group.id': req.body.googlegroup.group.id}, function (err, srv) {
        if (err) {
          res.send(500, new Error(err));
          return cb(true);
        }
        if (srv) {
          res.send(409, new Error('A connection to this service has already been made'));
          return cb(true);
        }
        return cb();
      });
    });
  }
  else if (req.body.type === 'mailchimp') {
    // TODO: verify that mailchimp API key is valid
    Service.findOne({status: true, type: 'mailchimp', 'mc_api_key': req.body.mc_api_key, 'mc_list.id': req.body.mc_list.id}, function (err, srv) {
      if (err) {
        res.send(500, new Error(err));
        return cb(true);
      }
      if (srv) {
        res.send(409, new Error('A connection to this service has already been made'));
        return cb(true);
      }
      return cb();
    });
  }
}

// Create a new service
function post(req, res, next) {
  // TODO: verify that the service is valid (ie API key is valid)
  verifyService(req, res, function (err) {
    if (err) {
      return next();
    }
    var serviceModel = new Service(req.body);
    serviceModel.save(function(err, service) {
      if (err) {
        res.send(400, new Error(err));
      } else {
        res.status(201);
        res.header('Location', '/v0.1/services/' + service._id);
        res.json(service);
      }
      next();
    });
  });
}

// Update an existing service
function put(req, res, next) {
  verifyService(req, res, function (err) {
    if (err) {
      return next();
    }
    Service
      .findByIdAndUpdate(req.params.id, req.body)
      .populate('owners')
      .exec(function(err, service) {
        if (err) {
          res.send(400, new Error(err));
        } else {
          if (service) {
            res.send(200, service);
          } else {
            res.send(404, new Error('Service ' + req.params.id + ' not found'));
          }
        }
        next();
      });
  });
}

// Delete a service: set its status to false
function del(req, res, next) {
  Service.findByIdAndUpdate(req.params.id, { $set: { status: false }}, function(err, service) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    } else {
      if (service) {
        res.send(204);
        return next();
      }
      else {
        res.send(404, new Error("Service " + req.params.id + " not found"));
        return next();
      }
    }
  });
}

// Find a service by ID
function getById(req, res, next) {
  Service
    .findById(req.params.id)
    .populate('owners')
    .exec(function(err, service) {
    if (err) {
      res.send(500, new Error(err));
    } else {
      if (service) {
        var isOwner = false;
        if (service.owners) {
          service.owners.forEach(function (owner) {
            if(owner._id.equals(req.apiAuth.userProfile._id)) {
              isOwner = true;
            }
          });
        }
        if (req.apiAuth.userId == service.userid || (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && roles.has(req.apiAuth.userProfile, 'admin')) || isOwner) {
          res.send(200, service);
        }
        else {
          // Remove mailchimp API key if user is not an admin or the owner of the service
          service.sanitize();
          res.send(200, service);
        }
      } else {
        res.send(404, new Error("Service " + req.params.id + " not found"));
      }
    }
    next();
  });
}

// Find services
function get(req, res, next) {
  var params = {};
  if (req.query.q) {
    params = {name: new RegExp(req.query.q, 'i')};
  }
  if (req.query.status) {
    params.status = req.query.status;
  }
  if (req.query.hidden) {
    params.hidden = req.query.hidden;
  }
  if (req.query.location) {
    params['locations.remote_id'] = req.query.location;
  }
  if (!roles.has(req.apiAuth.userProfile, 'admin') && !roles.has(req.apiAuth.userProfile, 'manager')) {
    params = { $and: [params, { $or: [ {hidden: false }, {userid: req.apiAuth.userProfile.userId } ] } ] };
  }
  Service.find(params, function (err, services) {
    if (err) {
      res.send(500, new Error(err));
    }
    else {
      if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && roles.has(req.apiAuth.userProfile, 'admin')) {
          res.send(200, services);
      }
      else {
        services.forEach(function (service) {
          if (service.userid != req.apiAuth.userId) {
            service.sanitize();
          }
        });
        res.send(200, services);
      }
    }
    next();
  });
}

// Get mailchimp lists from API key
function mcLists(req, res, next) {
  if (req.query.mc_api_key) {
    var mc = new mcapi.Mailchimp(req.query.mc_api_key);
    mc.lists.list({}, function (listData) {
      res.send(200, listData);
      next();
    }, function (err) {
      res.send(500, new Error(err.error));
      next();
    });
  }
  else {
    res.send(400, new Error('missing Mailchimp API key'));
    next();
  }
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function googleGroupsAuthorize(credentials, callback) {
  var clientSecret = credentials.secrets.installed.client_secret;
  var clientId = credentials.secrets.installed.client_id;
  var redirectUrl = credentials.secrets.installed.redirect_uris[0];
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
  oauth2Client.credentials = credentials.token;
  callback(oauth2Client);
}

// Get google groups from a domain
function googleGroups(req, res, next) {
  if (req.query.domain) {
    // Find service credentials associated to domain
    ServiceCredentials.findOne({ type: 'googlegroup', 'googlegroup.domain': req.query.domain}, function (err, creds) {
      if (err) {
        res.send(500, new Error(err));
        return next();
      }
      if (!creds) {
        res.send(400, new Error('Invalid domain'));
        return next();
      }
      googleGroupsAuthorize(creds.googlegroup, function (auth) {
        var service = google.admin('directory_v1');
        service.groups.list({
          auth: auth,
          customer: 'my_customer',
          maxResults: 10
        }, function (err, response) {
          if (err) {
            res.send(500, new Error(err));
            return next();
          }
          var groups = response.groups;
          res.send(200, groups);
          next();
        });
      });
    });
  }
  else {
    res.send(400, new Error('missing domain URL'));
    next();
  }
}

// Middleware access function to check permissions to subscribe/unsubscribe a profile to a service
function subscribeAccess(req, res, next) {
  async.series([
    function (cb) {
      middleware.require.access(req, res, cb);
    },
    function (cb) {
      if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
        return cb();
      }
      if (req.apiAuth.userProfile) {
        if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && (roles.has(req.apiAuth.userProfile, 'admin') || roles.has(req.apiAuth.userProfile, 'manager'))) {
          return cb();
        }
        else {
          if (req.apiAuth.userProfile._id == req.params.id) {
            return cb();
          }
        }
        res.send(403, new Error('You are not allowed to do this'));
        cb(false);
      }
    }], function (err) {
      if (err) {
        return next(false);
      }
      next();
    }
  );
}

// Subscribe a profile to a service
function subscribe(req, res, next) {
  var profile = {}, service = {}, contact = {};
  if (!req.body || !req.body.service || !req.body.email) {
    res.send(400, new Error('Missing parameters'));
    return next();
  }
  async.series([
    function (cb) {
      // Find profile by id
      Profile.findById(req.params.id, function (err, prof) {
        if (err) {
          res.send(500, new Error(err));
          return cb(true);
        }
        if (!profile) {
          res.send(404, new Error('Profile ' + req.params.id + ' not found'));
          return cb(true);
        }
        profile = prof;
        return cb();
      });
    },
    function (cb) {
      // Find service by id
      Service.findById(req.body.service, function (err2, serv) {
        if (err2) {
          res.send(500, new Error(err));
          return cb(true);
        }
        if (!service) {
          res.send(400, new Error('Service ' + req.body.service + ' not found'));
          return cb(true);
        }
        if (profile.isSubscribed(service)) {
          res.send(409, new Error('Profile ' + req.params.id + ' already subscribed to ' + req.body.service));
          return cb(true);
        }
        service = serv;
        return cb();
      });
    },
    function (cb) {
      // Find global contact associated with profile
      Contact.findOne({ 'type': 'global', _profile: profile._id }, function (err, cont) {
        if (err) {
          res.send(500, new Error(err));
          return cb(true);
        }
        if (cont) {
          contact = cont;
        }
        return cb();
      });
    },
    function (cb) {
      if (!profile.subscriptions) {
        profile.subscriptions = [];
      }
      profile.subscriptions.push({ service: service, email: req.body.email});
      if (service.type === 'mailchimp') {
        var merge_vars = {};
        if (contact && contact.nameFamily && contact.nameGiven) {
          merge_vars.fname = contact.nameGiven;
          merge_vars.lname = contact.nameFamily;
        }
        var mc = new mcapi.Mailchimp(service.mc_api_key);
        mc.lists.subscribe({id: service.mc_list.id, email: {email: req.body.email}, merge_vars: merge_vars, double_optin: false}, function (data) {
          profile.save();
          if (req.apiAuth.userProfile && req.apiAuth.userProfile._id != req.params.id) {
            subscribeEmail('notify_subscribe', req.body.email, profile, req.apiAuth.userProfile, service);
          }
          res.header('Location', '/v0.1/profiles/' + profile._id + '/subscriptions/' + service._id);
          res.send(204);
          return cb();
        }, function (error) {
          if (error.name === 'List_AlreadySubscribed') {
            profile.save();
            res.header('Location', '/v0.1/profiles/' + profile._id + '/subscriptions/' + service._id);
            res.send(204);
            return cb();
          }
          res.send(500, new Error(error.error));
          return cb();
        });
      }
      else if (service.type === 'googlegroup') {
        // Subscribe email to google group
        ServiceCredentials.findOne({ type: 'googlegroup', 'googlegroup.domain': service.googlegroup.domain}, function (err, creds) {
          if (err) {
            res.send(500, new Error(err));
            return cb();
          }
          if (!creds) {
            res.send(400, new Error('Invalid domain'));
            return cb();
          }
          googleGroupsAuthorize(creds.googlegroup, function (auth) {
            var gservice = google.admin('directory_v1');
            gservice.members.insert({
              auth: auth,
              groupKey: service.googlegroup.group.id,
              resource: { 'email': req.body.email, 'role': 'MEMBER' }
            }, function (err, response) {
              if (!err || (err && err.code === 409)) {
                profile.save();
                if (req.apiAuth.userProfile && req.apiAuth.userProfile._id != req.params.id) {
                  subscribeEmail('notify_subscribe', req.body.email, profile, req.apiAuth.userProfile, service);
                }
                res.header('Location', '/v0.1/profiles/' + profile._id + '/subscriptions/' + service._id);
                res.send(204);
                return cb();
              }
              else {
                res.send(500, new Error(err));
                return cb();
              }
            });
          });
        });
      }
    }], function (err, result) {
      return next();
    }
  );
}

function subscribeEmail(template, to, profile, adminProfile, service) {
  var mailOptions = {
    to: to,
    subject: template === 'notify_subscribe' ? 'You have been subscribed to ' + service.name: 'You have been unsubscribed from ' + service.name,
    serviceName: service.name
  };

  async.series([
    function (cb) {
      Contact.findOne({type: 'global', _profile: profile}, function (err, contact) {
        if (err) {
          return cb(err);
        }
        if (contact) {
          mailOptions.recipientFirstName = contact.nameGiven;
        }
        return cb();
      });
    },
    function (cb) {
      Contact.findOne({type: 'global', _profile: adminProfile}, function (err, contact) {
        if (err) {
          return cb(err);
        }
        if (contact) {
          mailOptions.cc = contact.mainEmail(false);
          mailOptions.adminName = contact.fullName();
          if (template === 'notify_subscribe') {
            mailOptions.subject = mailOptions.adminName + ' has subscribed you to ' + service.name + ' on Humanitarian ID';
          }
          else {
            mailOptions.subject = mailOptions.adminName + ' has unsubscribed you from ' + service.name + ' on Humanitarian ID';
          }
        }
        return cb();
      });
    }], function (err) {
      if (!err) {
        // Send mail
        mail.sendTemplate(template, mailOptions, function (err, info) {
          if (err) {
            log.warn(err);
          }
        });
      }
    }
  );
}


// Unsubscribe a profile from a service
function unsubscribe(req, res, next) {
  Profile.findById(req.params.id, function (err, profile) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (!profile) {
      res.send(404, new Error('Profile ' + req.params.id + ' not found'));
      return next();
    }
    Service.findById(req.params.serviceId, function (err2, service) {
      if (err2) {
        res.send(500, new Error(err2));
        return next();
      }
      if (!service) {
        res.send(404, new Error('Service ' + req.params.serviceId + ' not found'));
        return next();
      }
      if (!profile.isSubscribed(service)) {
        res.send(404, new Error('Subscription not found'));
        return next();
      }
      var index = -1;
      for (var i = 0; i < profile.subscriptions.length; i++) {
        if (profile.subscriptions[i].service.equals(service._id)) {
          index = i;
        }
      }
      if (service.type === 'mailchimp') {
        var mc = new mcapi.Mailchimp(service.mc_api_key);
        mc.lists.unsubscribe({id: service.mc_list.id, email: {email: profile.subscriptions[index].email}}, function (data) {
          var email = profile.subscriptions[index].email;
          profile.subscriptions.splice(index, 1);
          profile.save();
          if (req.apiAuth.userProfile && req.apiAuth.userProfile._id != req.params.id) {
            subscribeEmail('notify_unsubscribe', email, profile, req.apiAuth.userProfile, service);
          }
          res.send(204);
          return next();
        }, function (error) {
          // if email is already unsubscribed, perform the action
          if (error.name === 'Email_NotExists') {
            profile.subscriptions.splice(index, 1);
            profile.save();
            res.send(204);
            return next();
          }
          res.send(500, new Error(error.error));
          return next();
        });
      }
      else if (service.type === 'googlegroup') {
        // Unsubscribe user from google group
        ServiceCredentials.findOne({ type: 'googlegroup', 'googlegroup.domain': service.googlegroup.domain}, function (err, creds) {
          if (err) {
            res.send(500, new Error(err));
            return next();
          }
          if (!creds) {
            res.send(400, new Error('Invalid domain'));
            return next();
          }
          googleGroupsAuthorize(creds.googlegroup, function (auth) {
            var gservice = google.admin('directory_v1');
            gservice.members.delete({
              auth: auth,
              groupKey: service.googlegroup.group.id,
              memberKey: profile.subscriptions[index].email
            }, function (err, response) {
              if (!err || (err && err.code === 404)) {
                profile.subscriptions.splice(index, 1);
                profile.save();
                if (req.apiAuth.userProfile && req.apiAuth.userProfile._id != req.params.id) {
                  subscribeEmail('notify_unsubscribe', email, profile, req.apiAuth.userProfile, service);
                }
                res.send(204);
                return next();
              }
              else {
                res.send(500, new Error(err));
                return next();
              }
            });
          });
        });
      }
    });
  });
}

// Return subscriptions of a profile
function subscriptions(req, res, next) {
  Profile
    .findById(req.params.id)
    .populate('subscriptions.service')
    .exec(function (err, profile) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (!profile) {
      res.send(404, new Error('Profile ' + req.params.id + ' not found'));
      return next();
    }
    res.send(200, profile.subscriptions.map(function (value) { value.service.sanitize(); return value;}));
    return next();
  });
}

exports.putdelAccess = putdelAccess;
exports.postAccess = postAccess;
exports.post = post;
exports.put = put;
exports.del = del;
exports.getById = getById;
exports.get = get;
exports.mcLists = mcLists;
exports.googleGroups = googleGroups;
exports.subscribeAccess = subscribeAccess;
exports.subscribe = subscribe;
exports.unsubscribe = unsubscribe;
exports.subscriptions = subscriptions;
