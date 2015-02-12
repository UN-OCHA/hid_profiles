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
          else if (roles.has(userProfile, /[^admin$|^manager:|^editor:]/)) {
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
    origContact = null,
    origProfile = null,
    userid = req.body.userid || '',
    _profile = null,
    profileData = null,
    setContactData = false,
    setRoles = false,
    newRoles = [],
    setVerified = false,
    newVerified = false,
    setKeyContact = false,
    setProtectedRoles = false,
    newProtectedRoles = [];

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
    // Try to load the contact profile to determine if updating or creating
    function (cb) {
      if (contactFields._id) {
        var contactId = mongoose.Types.ObjectId(contactFields._id);
        Contact.findOne({_id: contactId}, function (err, doc) {
          if (!err && doc && doc._id) {
            origContact = doc;
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
                  origProfile = profile;
                  return cb();
                }
              });
            });
          }
          else {
            _profile = profile._id;
            origProfile = profile;
            return cb();
          }
        });
      }
      else {
        _profile = contactFields._profile;
        Profile.findOne({"_id": mongoose.Types.ObjectId(_profile)}, function (err, doc) {
          if (!err && doc && doc._id) {
            origProfile = doc;
          }
          return cb();
        });
      }
    },
    // If new roles are set, filter them by the valid roles list.
    function (cb) {
      newRoles = req.body.adminRoles || [];
      if (newRoles.length) {
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
    // If the user making this change is not an admin, then exclude protected
    // fields from the submission.
    function (cb) {
      // Set up basic agent role data
      var isAPI = req.apiAuth.mode === 'client',
        isAdmin = req.apiAuth.userProfile && roles.has(req.apiAuth.userProfile, /^admin$/),
        isManager = req.apiAuth.userProfile && roles.has(req.apiAuth.userProfile, /^manager:/),
        isEditor = req.apiAuth.userProfile && roles.has(req.apiAuth.userProfile, /^editor:/),
        isOwnProfile = req.apiAuth.userId && req.apiAuth.userId === req.body.userid,
        isManagersEditorsLocation = false,
        contactLocal = origContact ? origContact.type === 'local' : req.body.type === 'local',
        contactLocationId = origContact ? origContact.locationId : req.body.locationId;

      // If the contact type is local and has a location ID, then check if it matches the current manager's or editor's location.
      if (contactLocal) {
        if (isManager) {
          isManagersEditorsLocation = roles.has(req.apiAuth.userProfile, "manager", contactLocationId);
        }
        else if (isEditor) {
          isManagersEditorsLocation = roles.has(req.apiAuth.userProfile, "editor", contactLocationId);
        }
      }

      // Allow updating contact fields if this is the user's own contact, if
      // the user is API or admin, or if the contact is local and the user is a
      // manager/editor of the location.
      if (isAPI || isAdmin || isOwnProfile || isManagersEditorsLocation) {
        setContactData = true;
      }

      // Allow setting the Key Contact flag if the user is an admin or a
      // manager in the location of this profile.
      if (isAPI || isAdmin || (isManager && isManagersEditorsLocation)) {
        setKeyContact = true;
      }

      // Allow setting the Verified User flag if the user is an admin,
      // manager, or editor.
      if (req.body.hasOwnProperty("verified") && (isAPI || isAdmin || isManager || isEditor)) {
        setVerified = true;
        newVerified = req.body.verified;
      }

      // Allow setting protectedRoles if the user is an admin or a manager in
      // the location of this profile. Also, set the user to verified if any
      // protected roles are granted.
      if (req.body.hasOwnProperty("newProtectedRoles") && (isAPI || isAdmin || (isManager && isManagersEditorsLocation))) {
        setProtectedRoles = true;
        newProtectedRoles = req.body.newProtectedRoles;

        if (newProtectedRoles.length) {
          setVerified = true;
          newVerified = true;
        }
      }

      // Allow admins to change all roles, allow managers to only assign
      // managers/editors within their location, and allow editors to only
      // assign editors within own location.
      if (newRoles.length && (isAPI || isAdmin || isManager || isEditor)) {
        setRoles = true;

        var addRoles = _.difference(newRoles, origProfile.roles),
          removeRoles = _.difference(origProfile.roles, newRoles);

        // Check roles requested to add, and remove any not allowed.
        _.forEach(addRoles, function (val, idx, arr) {
          var roleParts = val.match(/(\w+):(.+)/);
          if (val === 'admin' && (isAPI || isAdmin)) {
            return;
          }
          else if (roleParts && roleParts[1] === 'manager' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]))) {
            return;
          }
          else if (roleParts && roleParts[1] === 'editor' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]) || roles.has(req.apiAuth.userProfile, 'editor:' + roleParts[2]))) {
            return;
          }

          // Role change is not permitted, remove it from newRoles.
          while ((idx = newRoles.indexOf(val)) !== -1) {
            newRoles.splice(idx, 1);
          }
        });

        // Check roles requested to remove, and add any not allowed.
        _.forEach(removeRoles, function (val, idx, arr) {
          var roleParts = val.match(/(\w+):(.+)/);
          if (val === 'admin' && (isAPI || isAdmin)) {
            return;
          }
          else if (roleParts && roleParts[1] === 'manager' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]))) {
            return;
          }
          else if (roleParts && roleParts[1] === 'editor' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]) || roles.has(req.apiAuth.userProfile, 'editor:' + roleParts[2]))) {
            return;
          }

          // Role change is not permitted, add it back to newRoles.
          newRoles.push(val);
        });

        // If any admin roles are granted, then also set the verified flag.
        if (newRoles.length) {
          setVerified = true;
          newVerified = 1;
        }
      }
      return cb();
    },
    // Upsert the contact
    function (cb) {
      var upsertId = mongoose.Types.ObjectId(contactFields._id || null);
      delete contactFields._id;
      contactFields._profile = _profile;

      // Remove fields that should be protected
      if (!setKeyContact) {
        delete contactFields.keyContact;
      }
      if (setProtectedRoles) {
        contactFields.protectedRoles = newProtectedRoles;
      }

      // If no contact fields should be updated, continue to check the profile
      if (!_.keys(contactFields).length) {
        return cb();
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
          else {
            return cb(err);
          }
        });
        return;
      }
      else {
        return cb();
      }
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}

exports.post = post;
exports.postAccess = postAccess;
