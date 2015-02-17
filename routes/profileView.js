var async = require('async'),
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  log = require('../log');

function get(req, res, next) {
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
          log.warn({'type': 'profileView:error', 'message': 'Error occurred while performing query for profiles.', 'err': err});
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
            log.warn({'type': 'profileView:error', 'message': 'Error occurred while performing query for contacts related to this profile.', 'err': err});
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
      log.info({'type': 'profileView:success', 'message': 'Successfully returned data for profileView query.', 'query': query});
      return cb();
    }
  ], function (err, results) {
    next();
  });
}

exports.get = get;
