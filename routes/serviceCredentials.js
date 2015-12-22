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

// Find services
function get(req, res, next) {
  var params = {};
  ServiceCredentials.find(params, function (err, creds) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.length && (roles.has(req.apiAuth.userProfile, 'admin') || roles.has(req.apiAuth.userProfile, 'manager'))) {
      creds.forEach(function (cred) {
        cred.sanitize();
      });
      res.send(200, creds);
      return next();
    }
    else {
      res.send(403, new Error('No access'));
      return next();
    }
  });
}

exports.get = get;
