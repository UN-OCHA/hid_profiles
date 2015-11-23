var async = require('async'),
  _ = require('lodash'),
  mcapi = require('../node_modules/mailchimp-api/mailchimp'),
  log = require('../log'),
  config = require('../config'),
  roles = require('../lib/roles.js'),
  mail = require('../mail'),
  Service = require('../models').Service,
  Profile = require('../models').Profile;

// Middleware function to grant/deny access to the listSave routes.
function isAdminOrOwner(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (err) {
          res.send(500, new Error(err));
          return next(false);
        }
        if (!userProfile) {
          res.send(401, new Error('No profile associated to this user id was found'));
          return next(false);
        }

        req.apiAuth.userProfile = userProfile;
        if (userProfile.roles && userProfile.roles.length && roles.has(userProfile, /[^admin$|^manager:]/)) {
          return next();
        }
        else {
          Service.findById(req.params.id, function (err2, service) {
            if (err2) {
              res.send(500, new Error(err));
              return next(false);
            }
            if (!service) {
              res.send(404, new Error('Service ' + req.params.id + ' not found'));
              return next(false);
            }
            if (service.userid != req.apiAuth.userId) {
              res.send(403, new Error('You are not allowed to do this'));
              return next(false);
            }
            else {
              return next();
            }
          });
        }
      });
    }
  }
  else {
    res.send(401, new Error('Invalid authentication'));
    return next(false);
  }
}

function isAdminOrManager(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (err) {
          res.send(500, new Error(err));
          return next(false);
        }
        if (!userProfile) {
          res.send(401, new Error('No profile associated to this user id was found'));
          return next(false);
        }

        req.apiAuth.userProfile = userProfile;
        if (userProfile.roles && userProfile.roles.length && roles.has(userProfile, /[^admin$|^manager:]/)) {
          return next();
        }
        else {
          res.send(403, new Error('You are not allowed to do this'));
          return next(false);
        }
      });
    }
  }
  else {
    res.send(401, new Error('Invalid authentication'));
    return next(false);
  }
}

function getAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (err) {
          res.send(500, new Error(err));
          return next(false);
        }
        if (!userProfile) {
          res.send(401, new Error('No profile associated to this user id was found'));
          return next(false);
        }

        req.apiAuth.userProfile = userProfile;
        return next();
      });
    }
  }
  else {
    res.send(401, new Error('Invalid authentication'));
    return next(false);
  }
}

// Create a new service
function post(req, res, next) {
  // TODO: verify that the service is valid (ie API key is valid)
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
}

// Update an existing service
function put(req, res, next) {
  Service.findByIdAndUpdate(req.params.id, req.body, function(err, service) {
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
}

// Delete a service
function del(req, res, next) {
  Service.findByIdAndRemove(req.params.id, function(err, service) {
    if (err) {
      res.send(500, new Error(err));
    } else {
      if (service) {
        res.send(204);
      }
      else {
        res.send(404, new Error("Service " + req.params.id + " not found"));
      }
    }
    next();
  });
}

// Find a service by ID
function getById(req, res, next) {
  Service.findById(req.params.id, function(err, service) {
    if (err) {
      res.send(500, new Error(err));
    } else {
      if (service) {
        if (req.apiAuth.userId == service.userid || (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && roles.has(req.apiAuth.userProfile, /[^admin$]/))) {
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
  Service.find(params, function (err, services) {
    if (err) {
      res.send(500, new Error(err));
    }
    else {
      if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && roles.has(req.apiAuth.userProfile, /[^admin$]/)) {
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
  var mc = new mcapi.Mailchimp(req.query.mc_api_key);
  mc.lists.list({}, function (listData) {
    res.send(200, listData);
  }, function (err) {
    res.send(500, new Error(err.error));
  });
}

// Subscribe a profile to a service
function subscribe(req, res, next) {
  Profile.findById(req.params.id, function (err, profile) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (!profile) {
      res.send(404, new Error('Profile ' + req.params.id + ' not found'));
      return next();
    }
    Service.findById(req.body.service, function (err2, service) {
      if (err2) {
        res.send(500, new Error(err));
        return next();
      }
      if (!service) {
        res.send(400, new Error('Service ' + req.body.id + ' not found'));
        return next();
      }
      if (profile.isSubscribed(service._id)) {
        res.send(409, new Error('Profile ' + req.params.id + ' already subscribed to ' + req.body.service));
        return next();
      }
      profile.subscribe(service);
      res.header('Location', '/v0.1/profiles/' + profile._id + '/subscriptions/' + service._id);
      res.send(204);
      return next();
    });
  });
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
        res.send(500, new Error(err));
        return next();
      }
      if (!service) {
        res.send(404, new Error('Service ' + req.params.serviceId + ' not found'));
        return next();
      }
      if (!profile.isSubscribed(service._id)) {
        res.send(404, new Error('Subscription not found'));
        return next();
      }
      profile.unsubscribe(service);
      res.send(204);
      return next();
    });
  });
}

// Return subscriptions of a profile
function subscriptions(req, res, next) {
  Profile.findById(req.params.id, function (err, profile) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (!profile) {
      res.send(404, new Error('Profile ' + req.params.id + ' not found'));
      return next();
    }
    res.send(200, profile.subscriptions);
    return next();
  });
}

exports.isAdminOrOwner = isAdminOrOwner;
exports.isAdminOrManager = isAdminOrManager;
exports.getAccess = getAccess;
exports.post = post;
exports.put = put;
exports.del = del;
exports.getById = getById;
exports.get = get;
exports.mcLists = mcLists;
exports.subscribe = subscribe;
exports.unsubscribe = unsubscribe;
exports.subscriptions = subscriptions;
