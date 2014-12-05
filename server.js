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

server.use(restify.CORS());

var Profile  = models.Profile,
    Contact  = models.Contact,
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

server.get(versionPrefix + 'profile/view', accountView);
server.post(versionPrefix + 'profile/view', accountView);

server.get(versionPrefix + 'profile/save/:uid', profileSave);
server.post(versionPrefix + 'profile/save/:uid', profileSave);

server.get(versionPrefix + 'contact/view', contactView);
server.post(versionPrefix + 'contact/view', contactView);

server.get(versionPrefix + 'contact/save', contactSave);
server.post(versionPrefix + 'contact/save', contactSave);

server.get('test', testpage);

server.get(versionPrefix + 'profile/model', accountModel);

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

function testpage(req, res, next) {
  res.send('hello from the test page');
  next();
}

function valid_security_creds(req) {
  return valid_security_creds_app(req) || valid_security_creds_user(req);
}

function valid_security_creds_user(req) {
  var access_token = req.query.access_token || '';

  // Step 1: Validate the access_token
  if (access_token.length) {
    console.log('access token provided: ' + access_token);
    req.oauthAccessToken = access_token;
    delete req.query.access_token;
/*
    var options = {
      hostname: 'auth.contactsid.vm',
      port: 80,
      path: '/upload',
  method: 'POST'
};

var req = http.request(options, function(res) {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ' + JSON.stringify(res.headers));
  res.setEncoding('utf8');
  res.on('data', function (chunk) {
    console.log('BODY: ' + chunk);
  });
});

req.on('error', function(e) {
  console.log('problem with request: ' + e.message);
});

// write data to request body
req.write('data\n');
req.write('data\n');
req.end();
*/
    return true;
  }
  return false;
}

function valid_security_creds_app(req) {
  var client_id   = req.query._access_client_id,
      access_key  = req.query._access_key;

  delete req.query._access_client_id;
  delete req.query._access_key;

  // Step 1: Validate that the client app is allowed
  // @TODO: Pull a list of allowed client IDs from Mongo and get the secret key at the same time
  var allowed_clients = [ '_access_client_id' ];
  if (allowed_clients.indexOf('_access_client_id') == -1) return false;

  var SHA256 = require("crypto-js/sha256");

  // @TODO: Get the secret key from Mongo for the requesting client app
  var correct_access_key  = '',
      valuesList          = flattenValues(req.query, ''),
      secret              = 'Kk6a8bk@HZBs';

  valuesList += secret;

  correct_access_key = SHA256(valuesList);

  // Debug: For comparing hash values
  // console.log("*** The received hash value was: " + access_key);
  // console.log("           I think it should be: " + correct_access_key);

  return (access_key == correct_access_key);
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
  if (!valid_security_creds(req)) {
    console.log('Invalid API key/secret')
    res.send(403, new Error('client or key not accepted'));
    return next();
  }

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
    else if (prop == '_access_client_id' || prop == '_access_key') {
      // do nothing
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
  if (!valid_security_creds(req)) {
    console.log('Invalid API key/secret')
    res.send(403, new Error('client or key not accepted'));
    return next();
  }

  profileFields = { };

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
  if (!valid_security_creds(req)) {
    console.log('Invalid API key/secret')
    res.send(403, new Error('client or key not accepted'));
    return next();
  }

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
  Contact.find(query, function (err, _contacts) {
    if (err) {
      console.dir(err);
      result = {status: "error", message: "Query failed for contacts."};
    }
    else {
      if (_contacts && _contacts.length) {
        contacts = _contacts;
      }
      result = {status: "ok", contacts: contacts};
    }
    res.send(result);
    next();
  });
}

function contactSave(req, res, next) {
  if (!valid_security_creds(req)) {
    console.log('Invalid API key/secret')
    res.send(403, new Error('client or key not accepted'));
    return next();
  }

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
    profileData = null;

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
        if (contactFields._id) {
          console.log("Updated contact " + contactFields._id + " for user " + userid);
        }
        else {
          console.log("Created contact for user " + userid);
        }
        result = {status: "ok", data: contactFields};
        return cb();
      });
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}
