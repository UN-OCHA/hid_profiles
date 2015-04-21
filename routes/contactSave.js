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
          else if (userProfile.roles && userProfile.roles.length && roles.has(userProfile, /[^admin$|^manager:|^editor:]/)) {
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
  var adminName = req.body.adminName || null;
  var adminEmail = req.body.adminEmail || null;
  var message = null;
  var isGhost = false;
  var authEmail;

  var result = {},
    contactExists = false,
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
    newProtectedRoles = [],
    setProtectedBundles = false,
    newProtectedBundles = [];

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
        if (!contactFields.email[0].address || !contactFields.email[0].address.length){
          //This is a ghost account (no email) so create a new userid
          userid =  Date.now();
          isGhost = true;
          return cb();
        }
        else{
          authEmail = contactFields.email[0].address;
          //Create a new auth record for the new profile
          var request = {
            "email": authEmail,
            "nameFirst": contactFields.nameGiven,
            "nameLast": contactFields.nameFamily,
            "adminName": adminName,
            "adminEmail": adminEmail,
            "location": contactFields.location,
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
                userid =  obj.data.user_id;

                //If is_new returns a 0, auth service found an existing user record and no notification was sent
                //Create a notify_checkin email to notify of the user being checked into a location
                if (obj.data.is_new === 0){
                  var email = {
                    type: 'notify_checkin',
                    recipientFirstName: contactFields.nameGiven,
                    recipientLastName: contactFields.nameFamily,
                    recipientEmail: contactFields.email[0].address,
                    adminName: adminName,
                    locationName: contactFields.location
                  };
                  notifyEmail = email;
                  return cb();
                }
                else{
                  return cb();
                }
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
        //If isNewContact is true and its not a ghost account, verify that no existing contact record exists with new contact's email
        if (isNewContact && !isGhost){
          //See if contact record exists for new contact request - if so, return original contact record
          Contact.findOne({'email.address': authEmail}, function (err, doc) {
            if (!err && doc && doc._id) {
              result.origContact = doc;
              result.contactExists = true;
              return cb(true);
            }
            return cb();
          });
        }
        else{
          return cb();
        }
      }
    },
    // If no profile is specified, first lookup a profile by the userid, and if
    // none is found, then create a new one for the userid.
    function (cb) {
      if (contactFields._profile === null || !contactFields._profile || !contactFields._profile.length) {
        Profile.findOne({userid: userid}, function (err, profile) {
          if (err || !profile || !profile._id || userid === "") {
            log.info({'type': 'post', 'message': 'Creating new profile for userid ' + userid});
            Profile.update({userid: userid}, {userid: userid, status: 1}, {upsert: true}, function(err, profile) {
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
      newRoles = req.body.adminRoles || null;
      if (newRoles && newRoles.length) {
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

      // Allow setting protectedBundles if the user is an admin or a manager in
      // the location of this profile.
      if (req.body.hasOwnProperty("newProtectedBundles") && (isAPI || isAdmin || ((isManager || isEditor) && isManagersEditorsLocation))) {
        setProtectedBundles = true;
        newProtectedBundles = req.body.newProtectedBundles;
      }

      // Allow admins to change all roles, and allow managers to only assign
      // managers/editors within their location.
      if (newRoles && (newRoles.length || origProfile.roles.length) && (isAPI || isAdmin || isManager)) {
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
      if (setProtectedBundles) {
        contactFields.protectedBundles = newProtectedBundles;
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
        result = {status: "ok", data: contactFields, "_id": upsertId};
        return cb();
      });
    },
    // Update the related profile
    function (cb) {
      if (setRoles || setVerified || (!origProfile.firstUpdate && req.apiAuth.mode === 'user' && req.apiAuth.userId === origProfile.userid)) {
        Profile.findOne({_id: _profile}, function (err, profile) {
          if (!err && profile) {
            if (setRoles) {
              profile.roles = newRoles;
            }
            if (setVerified) {
              profile.verified = newVerified;
            }
            if (!origProfile.firstUpdate && req.apiAuth.mode === 'user' && req.apiAuth.userId === origProfile.userid) {
              profile.firstUpdate = Date.now();
            }
            if (req.body.orgEditorRoles){
              profile.orgEditorRoles = req.body.orgEditorRoles;
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
        if (notifyEmail.type == 'notify_edit' || notifyEmail.type == 'notify_checkin' || notifyEmail.type == 'notify_checkout') {
          var mailText, mailSubject, mailOptions, mailWarning, mailInfo, actionsEN, actionsFR;

          actionsEN = '';
          actionsFR = '';

          switch(notifyEmail.type) {
            case 'notify_checkin':
              mailSubject = 'Humanitarian ID check-in notification';
              mailWarning = {'type': 'notifyCheckinEmail:error', 'message': 'Check-in notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyCheckinEmail:success', 'message': 'Check-in notification email sending successful to ' + notifyEmail.to + '.'};
              actionsEN += '\r\n  • Added to contact list.';
              actionsFR += '\r\n  • ajouté à la liste des contacts.';
              break;
            case 'notify_checkout':
              mailSubject = 'Humanitarian ID check-out notification';
              mailWarning = {'type': 'notifyCheckoutEmail:error', 'message': 'Check-out notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyCheckoutEmail:success', 'message': 'Check-out notification email sending successful to ' + notifyEmail.to + '.'};
              actionsEN += '\r\n  • Removed from contact list.';
              actionsFR += '\r\n  • enlevé à la liste des contacts.';
              break;
            case 'notify_edit':
              mailSubject = 'Humanitarian ID check-in notification';
              mailWarning = {'type': 'notifyEditEmail:error', 'message': 'Edit notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyEditEmail:success', 'message': 'Edit notification email sending successful to ' + notifyEmail.to + '.'};
              break;
          }

          if (notifyEmail.addedGroups && notifyEmail.addedGroups.length) {
            notifyEmail.addedGroups.forEach(function(value) {
              actionsEN += '\r\n  • Added to ' + value + ' in ' + notifyEmail.locationName + '.';
              actionsFR += '\r\n  • ajouté a ' + value + ' en/au ' + notifyEmail.locationName + '.';
            });
          }

          if (notifyEmail.removedGroups && notifyEmail.removedGroups.length) {
            notifyEmail.removedGroups.forEach(function(value) {
              actionsEN += '\r\n  • Removed from ' + value + ' in ' + notifyEmail.locationName + '.';
              actionsFR += '\r\n  • enlevé a ' + value + ' en/au ' + notifyEmail.locationName + '.';
            });
          }

          if (notifyEmail.type === 'notify_edit') {
            actionsEN += '\r\n  • [Contact edited placeholder message (EN)]';
            actionsFR += '\r\n  • [Contact edited placeholder message (FR)]';
          }

          mailText = 'Dear ' + notifyEmail.recipientFirstName + ', \r\n\r\nWe wanted to let you know that your Humanitarian ID profile for ' + notifyEmail.locationName + ' has been updated by one of our locally based managers ' + notifyEmail.adminName + ' as follows:';
          mailText += actionsEN;
          mailText += '\r\n\r\nIf you feel that this action was not correct, simply log into your Humanitarian ID account and modify your profile for' + notifyEmail.locationName + '.';
          mailText += '\r\n\r\nThe Humanitarian ID team';
          mailText += '\r\nhttp://humanitarian.id';

          mailText += '\r\n\r\n—\r\n\r\n';

          mailText += 'Bonjour ' + notifyEmail.recipientFirstName + ', \r\n\r\nOn aimerait bien vous informer que votre profil sur Humanitarian ID en/au ' + notifyEmail.locationName + 'a été modifié par un de nos gestionnaires sur place' + notifyEmail.adminName + ':';
          mailText += actionsFR;
          mailText += '\r\n\r\nEn cas ou ceci n’est pas correct, on vous prie de bien vouloir vous connecter sur Humanitarian ID et modifier votre profile pour ' + notifyEmail.locationName  + '.'
          mailText += '\r\n\r\nL’équipe Humanitarian ID';
          mailText += '\r\nhttp://humanitarian.id';

          mailOptions = {
            from:  'Humanitarian ID<info@humanitarian.id>',
            to: notifyEmail.recipientEmail,
            subject: mailSubject,
            text: mailText
          };
          if (notifyEmail.adminEmail) {
            mailOptions.cc = !notifyEmail.adminName ? notifyEmail.adminEmail : notifyEmail.adminName + '<' + notifyEmail.adminEmail + '>';
          }

          // Send mail
          mail.sendMail(mailOptions, function (err, info) {
            if (err) {
              mailWarning.err = err;
              log.warn(mailWarning);
              return cb(true);
            }
            else {
              log.info(mailInfo);
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

function resetPasswordPost(req, res, next) {
  // Issue a request for a password reset to the auth system.
  var request = {
    'email': req.body.email || '',
    'emailFlag': req.body.emailFlag || null,
    'adminName': req.body.adminName || null
  };

  var new_access_key = middleware.require.getAuthAccessKey(request);
  request["access_key"] = new_access_key.toString();

  var client_key = config.authClientId;
  request["client_key"] = client_key

  var client = restify.createJsonClient({
    url: config.authBaseUrl,
    version: '*'
  });

  client.post("/api/resetpw", request, function(err, authReq, authRes, data) {
    if (authRes.statusCode == 200 && data.status === 'ok') {
      log.info({'type': 'resetPassword:success', 'message': 'Successfully requested reset password email for user with email ' + request.email, 'requestData': request, 'responseData': data});
    }
    else {
      log.warn({'type': 'resetPassword:error', 'message': 'Could not request reset password email. Received message: ' + data.message, 'requestData': request, 'responseData': data});
    }
    res.send(data);
    next();
  });
}

exports.post = post;
exports.postAccess = postAccess;
exports.resetPasswordPost = resetPasswordPost;
