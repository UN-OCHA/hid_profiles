var async = require('async'),
  _ = require('lodash'),
  operations = require('../lib/operations'),
  List = require('../models').List,
  Profile = require('../models').Profile;

function get(req, res, next) {
  var lockedOperations = [];
  async.series([
    function(cb) {
      operations.getLockedOperations(function (err, _lockedOperations) {
        if (err) {
          return cb(err);
        }
        lockedOperations = _lockedOperations;
      });

      cb();
    },
    function(cb) {
      if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
        Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
          if (err) {
            return cb(err);
          }

          if (!err && profile && profile._id) {
            if (!profile.verified) {
              req.limitContacts = true;
            }
          }
        });
      }

      cb();
    },
  ], function(err) {
    if (err) {
      return res.json({status: "error", message: "Could not view contact list."});
    }
    // Only find lists that users have access to.
    if (req.query.id) {
      List.findOne({_id:req.query.id})
      .populate('contacts')
      .exec(function (err, list) {
        if (err) {
          return res.json({status: "error", message: "There was an error retrieving the custom contact list."});
        }

        // Trusted Apis & Verified User
        if (req.limitContacts) {
          var contacts = [];
          _.forEach(list.contacts, function(contact) {
            if (lockedOperations.indexOf(contact.locationId) == -1) {
              contacts.push(contact);
            }
          });
          list.contacts = contacts;
        }

        res.json({ status: "ok", lists: list });
      });
    } else {
      List.find({users: req.apiAuth.userId }, function(err, lists){
        if (err) {
          return res.json({status: "error", message: "There was an error retrieving the custom contact lists."});
        }
        res.json({ status: "ok", lists: lists });
      });
    }
  });
}

exports.get = get;
