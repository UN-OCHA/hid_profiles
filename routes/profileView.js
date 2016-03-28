var async = require('async'),
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  operations = require('../lib/operations'),
  log = require('../log');

function get(req, res, next) {
  var docs  = { },
      query = { },
      queryContactId = false,
      userCanViewAllContacts = false;

  for (var prop in req.query) {
    if (!req.query.hasOwnProperty(prop)) {
      continue;
    }

    // TODO: Do some proper validation about the parameter name and its value
    var val = req.query[prop];
    if (prop == 'userid') {
      query[prop] = val;
    }
    else if (prop === 'contactId') {
      queryContactId = val;
    }
    else {
      query[prop] = val;
    }
  }

  var profile = {},
    contacts = [];
  async.series([
    // Check permissions
    function (cb) {
      // Trusted API clients are allowed read access to all contacts.
      if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
        userCanViewAllContacts = true;
        return cb();
      }
      // Users are allowed to see all of their own contacts.
      else if (req.apiAuth.mode === 'user' && req.apiAuth.userId && query.userid === req.apiAuth.userId) {
        userCanViewAllContacts = true;
        return cb();
      }
      // Admins and verified users are allowed to see anyone's contacts.
      else {
        Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
          if (!err && profile && profile._id && profile.verified) {
            userCanViewAllContacts = true;
          }
          return cb();
        });
      }
    },
    // Allow searching for a profile by the ID of a contact that references it.
    function (cb) {
      if (!queryContactId) {
        return cb();
      }

      Contact.findOne({'_id': queryContactId}, function (err, contact) {
        if (contact && contact._id && contact._profile) {
          query._id = contact._profile;
        }
        return cb();
      });
    },
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
      var query = {};
      query = {'_profile': profile._id, status: '1'};
      if (queryContactId) {
        query = { '_profile': profile._id, $or: [{ status: '1'}, {_id: queryContactId}] };
      }
      if (profile && profile._id) {
        Contact.find(query, function (err, _contacts) {
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
      if (!userCanViewAllContacts) {
        operations.filterLockedOperations(contacts, function (err, filteredContacts) {
          contacts = filteredContacts;
          return cb();
        });
      }
      else {
        return cb();
      }
    },
    function (cb) {
      var expires = false;
      if (profile.userid == req.apiAuth.userId) {
        contacts.forEach(function (contact) {
          if (contact.expires) {
            contact.expires = false;
            contact.save();
          }
        });
        if (profile.expires) {
          profile.expires = false;
          profile.save();
        }
      }
      return cb();
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
