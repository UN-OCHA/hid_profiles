var async = require('async'),
  _ = require('lodash'),
  mongoose = require('../models').mongoose,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  roles = require('../lib/roles.js'),
  log = require('../log'),
  config = require('../config'),
  restify = require('restify'),
  middleware = require('../middleware');
  mail = require('../mail');

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
        log.warn({'type': 'contactSaveAccess:error', 'message': 'User ' + req.apiAuth.userId + ' is not authorized to save contact for ' + req.body.userid, 'req': req});
        res.send(403, new Error('User not authorized to save contact'));
        return next(false);
      });
      return;
    }
  }
  log.warn({'type': 'contactSaveAccess:error', 'message': 'Client not authorized to save contact', 'req': req});
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

  var isNewContact = req.body.isNewContact || false;
  var notifyEmail = req.body.notifyEmail || null;
  var message = null;

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
    //Check to see if userid is set - if isNewContact is false, return an error
    //If isNewContact and no email is specified for the new profile, we are creating a ghost account so create a random user id
    //If isNewContact and email does exist, we are creating an orphan account and will need to create an auth record for the new account
    function (cb) {
      if ((!userid || !userid.length) && !isNewContact) {
        result = {status: "error", message: "No user ID was specified."};
        log.warn({'type': 'contactSave:error', 'message': 'contactSave: invalid request: No user ID was specified.', 'req': req});
        return cb(true);
      }
      else if ((!userid || !userid.length) && isNewContact){
        //New contact
        if (!contactFields.email){
          //This is a ghost account (no email) so create a new userid
          userid =  Date.now();
          return cb();
        }
        else{
          //Create a new auth record for the new profile
          var request = {
            "email": contactFields.email,
            "nameFirst": contactFields.nameGiven,
            "nameLast": contactFields.nameFamily,
            "active": 1,
            'emailFlag': '1' //Orphan email
          };

          var new_access_key = middleware.require.getAuthAccessKey(request);
          request["access_key"] = new_access_key.toString();

          var client_key = config.authClientId;
          request["client_key"] = client_key

          var client = restify.createJsonClient({
            url: config.authBaseUrl,
            version: '*'
          });

          client.post("/api/register", request, function(err, req, res, data) {
            if (res.statusCode == 200 && res.body) {
              var obj = JSON.parse(res.body);
              if (obj && obj.data && obj.data.user_id) {
                // Set userid to the userid returned from the auth service
                userid = obj.data.user_id;
                return cb();
              }
            }

            log.warn({'type': 'contactSave:error', 'message': 'contactSave: An unsuccessful response was received when trying to create a user account on the authentication service.', 'req': req, 'res': res});
            result = {status: "error", message: "Could not create user account. Please try again or contact an administrator."};
            return cb(true);
          });
        }
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
          if (err || !profile || !profile._id || userid === "") {
            log.info({'type': 'post', 'message': 'Creating new profile for userid ' + userid});
            Profile.update({_userid: userid}, {userid: userid, status: 1}, {upsert: true}, function(err, profile) {
              if (err) {
                log.warn({'type': 'post:error', 'message': 'Error occurred while trying to update/insert profile for user ID ' + userid, 'err': err});
                result = {status: "error", message: "Could not create profile for user."};
                return cb(true);
              }
              Profile.findOne({userid: userid}, function (err, profile) {
                if (err || !profile || !profile._id) {
                  log.warn({'type': 'post:error', 'message': 'Error occurred or could not find profile for user ' + userid + ' after creating it.', 'err': err});
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
      if (req.body.hasOwnProperty("newProtectedRoles") && (isAPI || isAdmin || ((isManager || isEditor) && isManagersEditorsLocation))) {
        setProtectedRoles = true;
        newProtectedRoles = req.body.newProtectedRoles;

        if (newProtectedRoles.length) {
          setVerified = true;
          newVerified = true;
        }
      }

      // Allow admins to change all roles, and allow managers to only assign
      // managers/editors within their location.
      if ((newRoles.length || origProfile.roles.length) && (isAPI || isAdmin || isManager)) {
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
          else if (roleParts && roleParts[1] === 'editor' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]))) {
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
          else if (roleParts && roleParts[1] === 'editor' && (isAPI || isAdmin || roles.has(req.apiAuth.userProfile, 'manager:' + roleParts[2]))) {
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
          log.warn({'type': 'contactSave:error', 'message': 'Error occurred while attempting to upsert contact with ID ' + upsertId, 'fields': contactFields, 'err': err});
          result = {status: "error", message: "Could not update contact."};
          return cb(true);
        }
        if (upsertId) {
          log.info({'type': 'contactSave:success', 'message': "Updated contact " + upsertId + " for user " + userid});
        }
        else {
          log.info({'type': 'contactSave:success', 'message': "Created contact " + upsertId + " for user " + userid});
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
              log.info({'type': 'contactSave:success', 'message': "Updated profile " + _profile + " to change admin roles for user " + userid});
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
    // Send emails (if applicable)
    function (cb) {
      if (notifyEmail) {
        if (notifyEmail.type == 'notify_checkout'){
          var mailText = 'Dear ' + notifyEmail.recipientFirstName + ', \r\n\r\nIt seems that you have left ' + notifyEmail.locationName + ' as a humanitarian responder. Therefore you have been checked out by one of our locally based managers (' + notifyEmail.adminName + ') and are no longer part of the respective contact list.';
          mailText += '\r\n\r\nNote that in the future you are able to quickly check-in and out of any disasters using your global Humanitarian ID profile. By doing so, you can control your details on the contact list when responding and remove your details when you leave.';
          mailText += '\r\n\r\nThe Humanitarian ID team\r\nhttp://humanitarian.id';
          mailText += '\r\n\r\n\r\n';
          mailText += 'Bonjour ' + notifyEmail.recipientFirstName + ', \r\n\r\nIl semble que vous ne répondez plus à la crise humanitaire en ' + notifyEmail.locationName + '. De ce fait vous le gestionnaire, ' + notifyEmail.adminName + ', sur place vous a déconnecté ce qui fait que vous avez été enlevé de la liste de contact en question.';
          mailText += '\r\n\r\nVous pouvez vous enregistrer et déconnecter d’une liste des contacts humanitaires en modifiant votre profil global sur Humanitarian ID. Cela vous permet de contrôler vos coordonnées et d’aider aux autres de vous trouver et vice versa.';
          mailText += '\r\n\r\nL’équipe Humanitarian ID\r\nhttp://humanitarian.id';

          var mailOptions = {
            from:  'Humanitarian ID<info@humanitarian.id>',
            to: notifyEmail.recipientEmail,  
            subject: 'Humanitarian ID check-out notification', 
            text: mailText
          };

          // Send mail
          mail.sendMail(mailOptions, function (err, info) {
            if (err) {
              log.warn({'type': 'notifyCheckoutEmail:error', 'message': 'Check-out notification email sending failed to ' + notifyEmail.to + '.', 'err': err});
              return cb(true);
            }
            else {
              log.info({'type': 'notifyCheckoutEmail:success', 'message': 'Check-out notification email sending successful to ' + notifyEmail.to});
              options = {};
              return cb();
            }
          });
        }
        else if (notifyEmail.type == 'notify_checkin'){
          var mailText = 'Dear ' + notifyEmail.recipientFirstName+ ', \r\n\r\nIt seems that you have joined the humanitarian response in ' + notifyEmail.locationName + '. ';
          mailText += 'Therefore, you have been checked-in by one of our locally based managers, ' + notifyEmail.adminName + ', and are now part of the respective contact list.';
          mailText += '\r\n\r\nNote that in the future you are able to quickly check-in and out of any disaster using your global Humanitarian ID profile. By doing so, you can control your details on the contact list, enable others to find you, and search for other responders.';
          mailText += '\r\n\r\nThe Humanitarian ID team\r\nhttp://humanitarian.id';
          mailText += '\r\n\r\n\r\n';
          mailText += 'Bonjour ' + notifyEmail.recipientFirstName + ', \r\n\r\nIl semble que vous répondez à la crise humanitaire en ' + notifyEmail.locationName + '. ';
          mailText += 'De ce fait vous avez été enregistré par le gestionnaire, ' + notifyEmail.adminName + ', sur place. A partir de maintenant vous faites partie du liste de contacts.';
          mailText += '\r\n\r\nVous pouvez vous enregistrer et déconnecter d’une liste des contacts humanitaires en modifiant votre profil global sur Humanitarian ID. Cela vous permet de contrôler vos coordonnées et d’aider aux autres de vous trouver et vice versa.';
          mailText += '\r\n\r\nL’équipe Humanitarian ID\r\nhttp://humanitarian.id';

          var mailOptions = {
            from:  'Humanitarian ID<info@humanitarian.id>',
            to: notifyEmail.recipientEmail, 
            subject: 'Humanitarian ID check-in notification', 
            text: mailText
          };

          // Send mail
          mail.sendMail(mailOptions, function (err, info) {
            if (err) {
              log.warn({'type': 'notifyCheckinEmail:error', 'message': 'Check-in notification email sending failed to ' + notifyEmail.to + '.', 'err': err});
              return cb(true);
            }
            else {
              log.info({'type': 'notifyCheckinEmail:success', 'message': 'Check-in notification email sending successful to ' + notifyEmail.to});
              options = {};
              return cb();
            }
          });
        }
        else{
           return cb();
        }
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
