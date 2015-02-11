var async = require('async'),
  _ = require('lodash'),
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  roles = require('../lib/roles.js'),
  mongoose = require('../models').mongoose;

// Middleware function to grant/deny access to the profileSave and contactSave
// routes.
function postAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all contacts.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    // Users are allowed write access only to their own contacts, unless they
    // have an administrative role.
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (!err) {
          if (userProfile) {
            req.apiAuth.userProfile = userProfile;
          }

          if (req.apiAuth.userId === req.body.userid) {
            return next();
          }
          else if (userProfile && userProfile.roles && userProfile.roles.indexOf("admin") !== -1) {
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

function post(req, res, next) {
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
    setProtectedRoles = false,
    newProtectedRoles = [],

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
      if (req.apiAuth.mode === 'client' || (req.apiAuth.userProfile && req.apiAuth.userProfile.roles && req.apiAuth.userProfile.roles.indexOf("admin") != -1)) {
        // Allow any field changes
        if (req.body.hasOwnProperty("verified")) {
          setVerified = true;
          newVerified = req.body.verified;
        }
        if (req.body.hasOwnProperty("adminRoles")) {
          setRoles = true;
          newRoles = req.body.adminRoles;

          // If any admin roles are granted, then also set the verified flag.
          if (req.body.adminRoles.length) {
            setVerified = true;
            newVerified = 1;
          }
        }
      }
      else {
        // Remove fields that should be protected
        delete contactFields.keyContact;
      }

      //If any protectedRoles are set, make sure the user is an admin make the user verified
      //Otherwise, we leave newProtectedRoles empty and setProtectedRoles = false, which will not update ProtectedRoles
      if (req.body.hasOwnProperty("newProtectedRoles")){
        if (req.apiAuth.userProfile.roles.indexOf("admin") != -1){
          setProtectedRoles = true;
          newProtectedRoles = req.body.newProtectedRoles;

          setVerified = true;
          newVerified = true;
        }
      }
      return cb();
    },
    // If new roles are set, filter them by the valid roles list.
    function (cb) {
      if (setRoles) {
        roles.get(function (err, rolesList) {
          if (!err && rolesList && rolesList.length) {
            validRoles = rolesList.map(function (val, idx, arr) { return val.id; });
            newRoles = _.intersection(newRoles, validRoles);
          }
          else {
            setRoles = false;
          }
          return cb();
        });
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

      if (setProtectedRoles){
        contactFields.protectedRoles = newProtectedRoles;
      }

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
        return;
      }
      return cb();
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}

exports.post = post;
exports.postAccess = postAccess;
