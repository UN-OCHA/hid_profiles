var restify = require('restify'),
  async = require('async'),
  config = require('../config'),
  Client = require('../models').Client,
  log = require('../log');

function appOrUser(req, res, next) {
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
    log.warn({'type': 'appOrUser:error', 'message': 'Request blocked due to invalid security credentials', 'req': req});
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
      url: config.authBaseUrl
    });
    client.get('/account.json?access_token=' + access_token, function(err, req, res, obj) {
      if (err) {
        log.warn({'type': 'validateUserCreds:error', 'message': 'Error occurred when verifying access token ' + access_token + ' with HID auth service.', 'err': err})
        cb(err, false);
      }
      else if (obj.user_id && obj.authorized_services) {
        log.info({'type': 'validateUserCreds:success', 'message': 'Verified API request access token for user ' + obj.user_id, 'req': req});
        req.apiAuth = {
          mode: "user",
          userId: obj.user_id,
          oauthAccessToken: access_token
        };
        cb(null, req.apiAuth);
      }
      else {
        log.warn({'type': 'validateUserCreds:error', 'message': 'Invalid API request access token ' + access_token + ' provided.', 'req': req});
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
        log.warn({'type': 'validateAppCreds:error', 'message': 'Error occurred when looking up client by client ID ' + client_id, 'req': req});
        cb(err, false);
      }
      else if (doc && doc.clientSecret && doc.clientSecret.length) {
        // Regenerate the access key using the known client secret.
        var new_access_key = SHA256(flattenValues(req.query, '') + doc.clientSecret);
        if (access_key === new_access_key.toString()) {
          log.info({'type': 'validateAppCreds:success', 'message': 'Verified API request for client ID ' + client_id, 'req': req});
          req.apiAuth = {
            mode: "client",
            clientId: client_id,
            trustedClient: true
          };
          cb(null, req.apiAuth);
        }
        else {
          log.warn({'type': 'validateAppCreds:error', 'message': 'Invalid API request key/secret combination for client ID ' + client_id, 'req': req});
          cb(null, false);
        }
      }
      else {
        log.warn({'type': 'validateAppCreds:error', 'message': 'Invalid API request client ID ' + client_id, 'req': req});
        cb(null, false);
      }
    });
  }
  else {
    cb(null, false);
  }
}

module.exports.getAuthAccessKey = function(req){
  //Get client access key
  var access_key = '';
  var SHA256 = require("crypto-js/sha256");
  var data = req;
  var valuesList = flattenValues(data, '') + config.authClientSecret;
  access_key = SHA256(valuesList);

  return access_key;
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

exports.appOrUser = appOrUser;
