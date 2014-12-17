var restify = require('restify');
var server = restify.createServer();
var async = require('async');
var Logger = require('bunyan');
// var routes = require('./routes');
var config = require('./config');
var models = require('./models');

server.use(restify.queryParser());

server.use(restify.bodyParser({
  maxBodySize: 16384,
}));

server.use(restify.CORS({
  origins: ['*'],
  credentials: true
}));

var Profile = models.Profile,
    Contact = models.Contact,
    Client = models.Client,
    mongoose = models.mongoose;

var versionPrefix = '/v0/';

var log = new Logger.createLogger({
  name: 'contactsid-profiles',
  serializers: {
    req: Logger.stdSerializers.req
  }
});
server.log = log;

server.pre(function (request, response, next) {
  request.log.info({req: request}, 'REQUEST');
  next();
});

server.get(versionPrefix + 'profile/view', valid_security_creds, accountView);
server.post(versionPrefix + 'profile/view', valid_security_creds, accountView);

server.get(versionPrefix + 'profile/save/:uid', valid_security_creds, contactSaveAccess, profileSave);
server.post(versionPrefix + 'profile/save/:uid', valid_security_creds, contactSaveAccess, profileSave);

server.get(versionPrefix + 'contact/view', valid_security_creds, contactView);
server.post(versionPrefix + 'contact/view', valid_security_creds, contactView);

server.get(versionPrefix + 'contact/save', valid_security_creds, contactSaveAccess, contactSave);
server.post(versionPrefix + 'contact/save', valid_security_creds, contactSaveAccess, contactSave);

server.get(versionPrefix + 'profile/model', accountModel);

// Provide handling for OPTIONS requests for CORS.
server.opts('.*', function(req, res, next) {
  var requestMethod,
    headers = 'X-Requested-With, Cookie, Set-Cookie, Accept, Access-Control-Allow-Credentials, Origin, Content-Type, Request-Id , X-Api-Version, X-Request-Id, Authorization';
  if (req.headers.origin && req.headers['access-control-request-method']) {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', headers);
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    requestMethod = req.headers['access-control-request-method'];
    res.header('Allow', requestMethod);
    res.header('Access-Control-Allow-Methods', requestMethod);
    res.send(204);
    return next();
  }
  res.send(404);
  return next();
});

server.listen(process.env.PORT || 4000, function() {
  console.log('%s listening at %s', server.name, server.url);
});

function accountModel(req, res, next) {
  var paths = Profile.schema.paths;
  
  delete paths._id;
  delete paths.__v;

  var keys = Object.keys(paths);

  res.send(keys);
  next();
}

function valid_security_creds(req, res, next) {
  async.parallel([
    function (cb) {
      valid_security_creds_app(req, cb);
    },
    function (cb) {
      valid_security_creds_user(req, cb);
    }
  ], function (err, results) {
    results = results.filter(function (val) { return val; });
    if (results.length && results[0].mode) {
      req.apiAuth = results[0];
      return next();
    }
    console.log('Invalid security credentials')
    res.send(403, new Error('client or key not accepted'));
    return next(false);
  });
}

function valid_security_creds_user(req, cb) {
  var access_token = req.query.access_token || '';

  // Step 1: Validate the access_token
  if (access_token.length) {
    delete req.query.access_token;

    var client = restify.createJsonClient({
      url: config.authBaseUrl,
      log: log
    });
    client.get('/account.json?access_token=' + access_token, function(err, req, res, obj) {
      if (err) {
        console.log('Could not confirm API request key/signature using access token ' + access_token);
        cb(err, false);
      }
      else if (obj.user_id && obj.authorized_services) {
        console.log('Verified API request key/signature from user ' + obj.user_id);
        req.apiAuth = {
          mode: "user",
          userId: obj.user_id,
          oauthAccessToken: access_token
        };
        cb(null, req.apiAuth);
      }
      else {
        console.log('Invalid API request key/signature using access token ' + access_token);
        cb(null, false);
      }
    });
  }
  else {
    cb(null, false);
  }
}

function valid_security_creds_app(req, cb) {
  var client_id = req.query._access_client_id || '',
    access_key = req.query._access_key || '',
    SHA256 = require("crypto-js/sha256");

  if (client_id.length || access_key.length) {
    delete req.query._access_client_id;
    delete req.query._access_key;

    // Step 1: Validate that the client app is allowed
    Client.findOne({clientId: client_id}, function (err, doc) {
      if (err) {
        console.log('Database query failed when searching for client by ID ' + client_id);
        cb(err, false);
      }
      else if (doc && doc.clientSecret && doc.clientSecret.length) {
        // Regenerate the access key using the known client secret.
        var new_access_key = SHA256(flattenValues(req.query, '') + doc.clientSecret);
        if (access_key === new_access_key) {
          console.log('Verified API request key/signature from client ' + client_id);
          req.apiAuth = {
            mode: "client",
            clientId: client_id,
            trustedClient: true
          };
          cb(null, req.apiAuth);
        }
        else {
          console.log('Invalid API request key/signature from client ' + client_id);
          cb(null, false);
        }
      }
      else {
        console.log('Invalid client ID provided for API request ' + client_id);
        cb(null, false);
      }
    });
  }
  else {
    cb(null, false);
  }
}

function flattenValues(q, strlist) {
  var tempList = '';
  for (var key in q) {
    var type = typeof q[key];
    if (type == 'object' || type == 'array') {
      tempList += flattenValues(q[key], tempList);
    }
    else {
      tempList += q[key];
    }
  }

  return tempList;
}

function accountView(req, res, next) {
  var docs  = { },
      query = { };

  for (var prop in req.query) {
    if (!req.query.hasOwnProperty(prop)) {
      continue;
    }

    // TODO: Do some proper validation about the parameter name and its value
    var val = req.query[prop];
    if (prop == 'userid') {
      query[prop] = val;
    }
    else {
      query[prop] = val;
    }
  }

  var profile = {},
    contacts = [];
  async.series([
    // Get the profile
    function (cb) {
      Profile.findOne(query, function (err, _profile) {
        if (err) {
          console.dir(err);
          return cb(err);
        }
        if (_profile && _profile._id) {
          profile = _profile;
        }
        return cb();
      });
    },
    // Get any active contacts related to this profile
    function (cb) {
      // @todo: @see http://mongoosejs.com/docs/populate.html
      if (profile && profile._id) {
        Contact.find({'_profile': profile._id, 'status': 1}, function (err, _contacts) {
          if (err) {
            console.dir(err);
            return cb(err);
          }
          if (_contacts && _contacts.length) {
            contacts = _contacts;
          }
          return cb();
        });
      }
      else {
        return cb();
      }
    },
    function (cb) {
      var account = {
        'profile': profile,
        'contacts': contacts
      };
      res.send(account);
      return cb();
    }
  ], function (err, results) {
    next();
  });
}

function profileSave(req, res, next) {
  //TODO: refactor and explore reuse of contactSave
  var profileFields = {};
  for (var prop in req.query) {
    profileFields[prop] = req.query[prop];
  }

  var userProfile = new Profile(profileFields);

  if (true) { // @TODO: Make room for data validation later
    var upsertData = userProfile.toObject();
    delete upsertData._id;

    var userProfileID = req.params.uid;
    if (req.params.uid == 0) {
      userProfileID = req.query.email + '_' + Date.now();
      userProfile.userid = userProfileID;
    }

    Profile.update({ userid: userProfileID }, upsertData, { upsert: true }, function(err) {
      if (err) console.dir(err);
      res.send(userProfile);
      console.dir(userProfile);
      next();
    });
  }
}

function contactView(req, res, next) {
  var docs = {},
    query = {},
    contactModel = (new Contact(req.query)).toObject();

  for (var prop in req.query) {
    if (req.query.hasOwnProperty(prop) && req.query[prop]) {
      var val = typeof req.query[prop] === 'String' ? req.query[prop] : String(req.query[prop]);
      if (!val || !val.length) {
        continue;
      }

      if (prop == '_id' || prop == '_profile') {
        query[prop] = val;
      }
      else if (prop == 'text') {
        query['$or'] = [
          {jobtitle: new RegExp(val, "i")},
          {nameGiven: new RegExp(val, "i")},
          {nameFamily: new RegExp(val, "i")},
          {'organization.name': new RegExp(val, "i")}
        ];
      }
      else if (contactModel.hasOwnProperty(prop)) {
        query[prop] = val;
      }
    }
  }

  var result = {},
    contacts = [];

  Contact.find(query).populate('_profile').exec(function (err, _contacts) {
    if (err) {
      console.dir(err);
      result = {status: "error", message: "Query failed for contacts."};
    }
    else {
      if (_contacts && _contacts.length) {
        contacts = _contacts;

        if (req.query.hasOwnProperty("verified") && req.query.verified) {
          contacts = _contacts.filter(function (item) {
            return item._profile && item._profile.verified;
          });
        }
      }
      result = {status: "ok", contacts: contacts};
    }
    res.send(result);
    next();
  });
}

// Middleware function to grant/deny access to the profileSave and contactSave
// routes.
function contactSaveAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all contacts.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    // Users are allowed write access only to their own contacts, unless they
    // have an administrative role.
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (!err && userProfile) {
          req.apiAuth.userProfile = userProfile;

          if (req.apiAuth.userId === req.body.userid) {
            return next();
          }
          else if (userProfile.roles && userProfile.roles.indexOf("admin") !== -1) {
            return next();
          }
        }
        console.log('User ' + req.apiAuth.userId + ' is not authorized to save contact for ' + req.body.userid);
        res.send(403, new Error('User not authorized to save contact'));
        return next(false);
      });
      return;
    }
  }
  console.log('Client not authorized to save contact');
  res.send(403, new Error('Client not authorized to save contact'));
  return next(false);
}

function contactSave(req, res, next) {
  var contactFields = {},
    contactModel = (new Contact(req.body)).toObject();

  for (var prop in req.body) {
    if (req.body.hasOwnProperty(prop) && contactModel.hasOwnProperty(prop)) {
      contactFields[prop] = req.body[prop];
    }
  }

  var result = {},
    userid = req.body.userid || '',
    _profile = null,
    profileData = null,
    setRoles = false,
    newRoles = [],
    setVerified = false,
    newVerified = false;

  async.series([
    // Ensure the userid is specified
    function (cb) {
      if (!userid || !userid.length) {
        result = {status: "error", message: "No user ID was specified."};
        console.log('contactSave: invalid request: No user ID was specified.');
        return cb(true);
      }
      else {
        return cb();
      }
    },
    // If the user making this change is not an admin, then exclude protected
    // fields from the submission.
    function (cb) {
      if (req.apiAuth.mode === 'client' || req.apiAuth.userProfile.roles.indexOf("admin") != -1) {
        // Allow any field changes
        if (req.body.hasOwnProperty("adminRoles")) {
          setRoles = true;
          newRoles = req.body.adminRoles;
        }
        if (req.body.hasOwnProperty("verified")) {
          setVerified = true;
          newVerified = req.body.verified;
        }
      }
      else {
        // Remove fields that should be protected
        delete contactFields.keyContact;
      }
      return cb();
    },
    // If no profile is specified, first lookup a profile by the userid, and if
    // none is found, then create a new one for the userid.
    function (cb) {
      if (contactFields._profile === null || !contactFields._profile || !contactFields._profile.length) {
        Profile.findOne({userid: userid}, function (err, profile) {
          if (err || !profile || !profile._id) {

            console.log('Creating new profile for userid ' + userid);
            Profile.update({_userid: userid}, {userid: userid, status: 1}, {upsert: true}, function(err, profile) {
              if (err) {
                console.dir(err);
                result = {status: "error", message: "Could not create profile for user."};
                return cb(true);
              }
              Profile.findOne({userid: userid}, function (err, profile) {
                if (err || !profile || !profile._id) {
                  result = {status: "error", message: "Could not find the created profile."};
                  return cb(true);
                }
                else {
                  _profile = profile._id;
                  return cb();
                }
              });
            });
          }
          else {
            _profile = profile._id;
            return cb();
          }
        });
      }
      else {
        _profile = contactFields._profile;
        return cb();
      }
    },
    // Upsert the contact
    function (cb) {
      var upsertId = mongoose.Types.ObjectId(contactFields._id || null);
      delete contactFields._id;
      contactFields._profile = _profile;

      Contact.update({_id: upsertId}, {'$set': contactFields}, {upsert: true}, function(err) {
        if (err) {
          console.dir(err);
          result = {status: "error", message: "Could not update contact."};
          return cb(true);
        }
        if (upsertId) {
          console.log("Updated contact " + upsertId + " for user " + userid);
        }
        else {
          console.log("Created contact for user " + userid);
        }
        result = {status: "ok", data: contactFields};
        return cb();
      });
    },
    // Update the related profile
    function (cb) {
      if (setRoles || setVerified) {
        Profile.findOne({_id: _profile}, function (err, profile) {
          if (!err && profile) {
            if (setRoles) {
              profile.roles = newRoles;
            }
            if (setVerified) {
              profile.verified = newVerified;
            }
            return profile.save(function (err, profile, num) {
              console.log("Updated profile " + _profile + " to change admin roles for user " + userid);
              return cb(err);
            });
          }
          return cb(err);
        });
      }
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}
