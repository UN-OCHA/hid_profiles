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
  req.userIsOrgEditor = false;
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
          else if (userProfile.orgEditorRoles && req.body.organization){
            //The user is an orgEditor and is updating the user's organization
            req.userIsOrgEditor = true;
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
    adminContact = null,
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
    newProtectedBundles = [],
    setOrgEditorRoles = false;

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
            client.close();

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
    function (cb) {
      //Verify that the orgEditor has rights to update the contact's organization for this location
      if (req.userIsOrgEditor == true){
        var found = false;
        var locationId = null;
        var organizationId = null;
        var userProfile = req.apiAuth.userProfile;

        if (userProfile && userProfile.orgEditorRoles && origContact && origContact.locationId){
          for (var role in userProfile.orgEditorRoles) {
            orgEditorRole = userProfile.orgEditorRoles[role];
            if (orgEditorRole && orgEditorRole.locationId == origContact.locationId) {
              found = true;
            }
          }
        }
        if (found){
          //Set user's profile verfied flag to true
          setVerified = true;
          newVerified = true;
          return cb();
        }
        else{
          result = {status: "error", message: "Client not authorized to update organization"};
          log.warn({'type': 'contactSave:error', 'message': 'contactSave: Client not authorized to update organization', 'req': req});
          return cb(true);
        }
      }
      else {
        return cb();
      }
    },
    //Verify if the user is updating their own profile and that their orgEditorRoles have changed
    function (cb) {
      if (req.apiAuth.mode === 'user' && req.apiAuth.userId === origProfile.userid){
        var userProfile = req.apiAuth.userProfile;
        var newOrgEditorRoles = req.body.orgEditorRoles;

        //If the user currently has orgEditorRoles and the request contains a different length, 
        //then make setOrgEditorRoles true so we update the profile
        if (userProfile.orgEditorRoles && newOrgEditorRoles ){
          if (userProfile.orgEditorRoles.length != newOrgEditorRoles.length){
            setOrgEditorRoles = true;
          }
        }
      }
      return cb();
    },
    // Upsert the contact
    function (cb) {
      var existingContact = false;
      if (contactFields._id){
        existingContact = true;
      }
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

      //Set last updated time stamp and created timestamp if this is a new 
      contactFields.revised = Date.now();
      if (!existingContact){
        contactFields.created = Date.now();
      }

      Contact.update({_id: upsertId}, {'$set': contactFields}, {upsert: true}, function(err) {
        if (err) {
          log.warn({'type': 'contactSave:error', 'message': 'Error occurred while attempting to upsert contact with ID ' + upsertId, 'fields': contactFields, 'err': err});
          result = {status: "error", message: "Could not update contact."};
          return cb(true);
        }
        if (existingContact) {
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
      if (setRoles || setVerified || setOrgEditorRoles || (!origProfile.firstUpdate && req.apiAuth.mode === 'user' && req.apiAuth.userId === origProfile.userid)) {
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
              profile.markModified('orgEditorRoles');
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
    // Find admin profile if applicable
    function (cb) {
      var isOwnProfile = req.apiAuth.userId && req.apiAuth.userId === req.body.userid;
      if (!isOwnProfile) {
        Contact.findOne({'_profile': req.apiAuth.userProfile._id, 'type': 'global'}, function (err, doc) {
          if (!err && doc && doc._id) {
            adminContact = doc;
          }
          return cb();
        });
      }
      else {
        return cb();
      }
    },
    // Send emails (if applicable)
    function (cb) {
      var isOwnProfile = req.apiAuth.userId && req.apiAuth.userId === req.body.userid;
      if (!isOwnProfile) {
        var emailContact = null, notifyEmail = { };
        if (req.body.status == 0) {
          emailContact = origContact._doc;
          notifyEmail.type = 'notify_checkout';
        }
        else {
          emailContact = contactFields;
          notifyEmail.type = 'notify_edit';
          if (!origContact) {
            notifyEmail.type = 'notify_checkin';
          }
        }
        notifyEmail.recipientEmail = emailContact.email[0].address;
        notifyEmail.recipientFirstName = emailContact.nameGiven;
        notifyEmail.locationName = emailContact.location || '';
        notifyEmail.locationType = emailContact.type;
        notifyEmail.locationId = emailContact.locationId || '';
        notifyEmail.adminName = adminContact.fullName();
        notifyEmail.adminEmail = adminContact.mainEmail(false);
        
        if (notifyEmail.type == 'notify_edit' || notifyEmail.type == 'notify_checkin' || notifyEmail.type == 'notify_checkout') {
          var mailText, mailSubject, mailOptions, mailWarning, mailInfo, actions, actionsEN, actionsFR, actionsFound, templateName;

          actions = [];
          actionsEN = [];
          actionsFR = [];
          actionsFound = false;

          switch(notifyEmail.type) {
            case 'notify_checkin':
              mailSubject = 'Humanitarian ID check-in notification';
              mailWarning = {'type': 'notifyCheckinEmail:error', 'message': 'Check-in notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyCheckinEmail:success', 'message': 'Check-in notification email sending successful to ' + notifyEmail.to + '.'};
              break;
            case 'notify_checkout':
              mailSubject = 'Humanitarian ID check-out notification';
              mailWarning = {'type': 'notifyCheckoutEmail:error', 'message': 'Check-out notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyCheckoutEmail:success', 'message': 'Check-out notification email sending successful to ' + notifyEmail.to + '.'};
              break;
            case 'notify_edit':
              mailSubject = 'Humanitarian ID profile edit notification';
              mailWarning = {'type': 'notifyEditEmail:error', 'message': 'Edit notification email sending failed to ' + notifyEmail.to + '.'};
              mailInfo = {'type': 'notifyEditEmail:success', 'message': 'Edit notification email sending successful to ' + notifyEmail.to + '.'};
              //Check for updated fields
              actions = addUpdatedFields(contactFields, origContact);
              if (actions.english.length > 0) {
                actionsFound = true;
                actionsEN = actions.english;
                actionsFR = actions.french;
              }
              break;
          }

          templateName = notifyEmail.type;
          if (templateName == 'notify_edit') {
            templateName += '_' + notifyEmail.locationType;
          }

          mailOptions = {
            to: notifyEmail.recipientEmail,
            cc: adminContact.mainEmail(false),
            subject: mailSubject, 
            recipientFirstName: notifyEmail.recipientFirstName,
            locationName: notifyEmail.locationName || '',
            adminName: notifyEmail.adminName,
            actionsEN: actionsEN,
            actionsFR: actionsFR
          };

          // Send mail
          //If editing profile and no actions were found, do not send email
          if (!(notifyEmail.type == 'notify_edit' && actionsFound == false)){
            mail.sendTemplate(templateName, mailOptions, function (err, info) {
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
        else if (notifyEmail.newOrg) {
          Profile.find({'orgEditorRoles.organizationId': notifyEmail.organizationId, 'orgEditorRoles.locationId': notifyEmail.locationId}, function (err, _profiles) {
            if (!err) {
              if (_profiles.length) {
                var query = {'locationId': notifyEmail.locationId, 'status': true, '$or':[]};;

                _.forEach(_profiles, function (val, key) {
                  if (val._id) {
                    query['$or'].push({'_profile': val._id});
                  }
                });

                Contact.find(query, function(err, _contacts) {
                  if (!err) {
                    if (_contacts.length) {
                      var emails = [];

                      _.forEach(_contacts, function(cont){
                        if (cont.email && cont.email[0] && cont.email[0].address) {
                          emails.push(cont.mainEmail(false));
                        }
                      });

                      if (emails.length) {
                        var mailText, mailOptions, mailWarning, mailInfo, person;

                        person = notifyEmail.recipientFirstName + " " + notifyEmail.recipientLastName;

                        mailOptions = {
                          to: emails.join(", "),
                          subject: person + " is noted as being part of " + notifyEmail.organization + " in " + notifyEmail.locationName + " on Humanitarian ID.",
                          person: person,
                          organization: notifyEmail.organization,
                          locationName: notifyEmail.locationName
                        };

                        // Send mail
                        mail.sendTemplate('notify_organization', mailOptions, function (err, info) {
                          if (err) {
                            mailWarning = {'type': 'notifyCheckoutEmail:error', 'message': 'Check-out notification email sending failed to ' + mailOptions.to + '.', 'err': err};
                            log.warn(mailWarning);
                            return cb(true);
                          }
                          else {
                            mailInfo = {'type': 'notifyCheckoutEmail:success', 'message': 'Check-out notification email sending successful to ' + mailOptions.to + '.'};
                            log.info(mailInfo);
                            options = {};
                            return cb();
                          }
                        });
                      }
                    }
                  }
                  return cb();
                });
              }
            }
            return cb();
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

function addUpdatedFields(contactFields, origContact){
  var actions = [];
  var valuesChanged = false;
  actions.english = [];
  actions.french = [];
  contactOrig = origContact._doc;
  contactNew = contactFields;

  //Name Given field
  if (contactOrig.nameGiven != contactNew.nameGiven){
     actions.english.push('Given Name name changed to: ' + contactNew.nameGiven);
     actions.french.push('Prénom modifié (nouveau prénom): ' + contactNew.nameGiven);
  }

  //Name Family field
  if (contactOrig.nameFamily != contactNew.nameFamily){
     actions.english.push('Family Name name changed to: ' + contactNew.nameFamily);
     actions.french.push ('Nom modifié (nouveau nom): ' + contactNew.nameFamily);
  }
  
  //Organization field
  //Organization was removed
  if (contactOrig.organization[0] != null && contactNew.organization[0] == null){
    actions.english.push('Organization Removed: ' + contactOrig.organization[0]._doc.name);
    actions.french.push('Organisation enlevée: ' + contactOrig.organization[0]._doc.name);
  }

  //Organization was added
  if (contactOrig.organization[0] == null && contactNew.organization[0] != null){
    actions.english.push('Organization Added: ' + contactNew.organization[0].name);
    actions.french.push('Organisation ajoutée: ' + contactNew.organization[0].name);
  }

  //Orgainziation was changed
  if (contactOrig.organization[0] != null && contactNew.organization[0] != null){
    if (contactOrig.organization[0]._doc.name != null && contactNew.organization[0].name != null) {
      if (contactOrig.organization[0]._doc.name != contactNew.organization[0].name) {
        actions.english.push('Organization changed to: ' + contactNew.organization[0].name);
        actions.french.push('Organisation modifié (novelle organisation): ' + contactNew.organization[0].name);
      }
    }
  }

  //Job title added
  if (contactOrig.jobtitle == null && contactNew.jobtitle != null){
    actions.english.push('Job title changed to: ' + contactNew.jobtitle);
    actions.french.push('Intitulé du poste modifié (nouveau nom):' + contactNew.jobtitle);
  }

  //Job title changed
  if (contactOrig.jobtitle != null && contactNew.jobtitle != null){
    if (contactOrig.jobtitle != contactNew.jobtitle){
      actions.english.push('Job title changed to: ' + contactNew.jobtitle);
      actions.french.push('Intitulé du poste modifié (nouveau nom): ' + contactNew.jobtitle);
    }
  }

  // Groups field
  var groupsRemoved = new Array(),
      groupsAdded = new Array();
  //Check if values changed
  if (origContact.bundle.length > 0 || contactNew.bundle.length > 0){
    origContact.bundle.forEach(function(value, i) {
      if (contactNew.bundle.indexOf(value) == -1) {
        groupsRemoved.push(value);
      }
    });
    contactNew.bundle.forEach(function(value, i) {
      if (origContact.bundle.indexOf(value) == -1) {
        groupsAdded.push(value);
      }
    });
  }

  if (origContact.protectedBundles.length > 0 || contactNew.protectedBundles.length > 0){
    origContact.protectedBundles.forEach(function(value, i) {
      if (contactNew.protectedBundles.indexOf(value) == -1 ){
        groupsRemoved.push(value);
      }
    });
    contactNew.protectedBundles.forEach(function(value, i) {
      if (origContact.protectedBundles.indexOf(value) == -1) {
        groupsAdded.push(value);
      }
    });
  }

  if (groupsRemoved.length || groupsAdded.length){
    var actionEn, actionFr;
    actionEn = 'You were ';
    actionFr = 'Vous avez été ';
    if (groupsAdded.length) {
      actionEn += 'added to ' + groupsAdded.toString();
      actionFr += 'ajouté à ' + groupsAdded.toString();
      if (groupsRemoved.length)  {
        actionEn += ' and ';
        actionFr += ' et ';
      }
    }
    if (groupsRemoved.length) {
      actionEn += ' removed from ' + groupsRemoved.toString();
      actionFr += ' enlevé de ' + groupsRemoved.toString();
    }
    actions.english.push(actionEn);
    actions.french.push(actionFr);
  }


  //Disasters field
  var disastersAdded = new Array(),
      disastersRemoved = new Array();
  if (origContact.disasters.length > 0 || contactNew.disasters.length > 0){
    origContact.disasters.forEach(function(value, i) {
      if (contactNew.disasters.indexOf(value) == -1) {
        disastersRemoved.push(value.name);
      }
    });
    contactNew.disasters.forEach(function (value, i) {
      if (origContact.disasters.indexOf(value) == -1) {
        disastersAdded.push(value.name);
      }
    });
  }
  if (disastersRemoved.length || disastersAdded.length){
    var actionEn, actionFr;
    actionEn = 'You were ';
    actionFr = 'Vous avez été ';
    if (disastersAdded.length) {
      actionEn += 'added to ' + disastersAdded.toString();
      actionFr += 'ajouté à ' + disastersAdded.toString();
      if (disastersRemoved.length)  {
        actionEn += ' and ';
        actionFr += ' et ';
      }
    }
    if (disastersRemoved.length) {
      actionEn += ' removed from ' + disastersRemoved.toString();
      actionFr += ' enlevé de ' + disastersRemoved.toString();
    }
    actions.english.push(actionEn);
    actions.french.push(actionFr);
  }

  //Address fields
  valuesChanged = false;
  if (origContact.address.length != contactNew.address.length) {
    valuesChanged = true;
  }
  else {
    //Check if values changed
    if (origContact.address.length > 0 && contactNew.address.length > 0) {
      //Country
      if (origContact.address[0].country && contactNew.address[0].country) {
        if (origContact.address[0].country != contactNew.address[0].country) {
           valuesChanged = true
        }
      }
      //Locality
      if (origContact.address[0].locality != null && contactNew.address[0].locality != null) {
        if (origContact.address[0].locality != contactNew.address[0].locality) {
           valuesChanged = true
        }
      }

      //Administrative area (Region/State)
      if (origContact.address[0].administrative_area == null && contactNew.address[0].administrative_area != null) {
        valuesChanged = true
      }
      if (origContact.address[0].administrative_area != null && contactNew.address[0].administrative_area == null) {
        valuesChanged = true
      }
      if (origContact.address[0].administrative_area != null && contactNew.address[0].administrative_area != null) {
        if (origContact.address[0].administrative_area != contactNew.address[0].administrative_area) {
          valuesChanged = true
        }
      }
    }
  }
  if (valuesChanged){
    actions.english.push('Current Location was updated');
    actions.french.push('Lieu actuel mis à jour');
  }

  //Office
  valuesChanged = false;
  if (origContact.office[0] == null && contactNew.office[0] != null) {
    valuesChanged = true
  }
  if (origContact.office[0] != null && contactNew.office[0] == null) {
    valuesChanged = true
  }
  if (origContact.office[0] != null && contactNew.office[0] != null) {
    if (origContact.office[0].name != contactNew.office[0].name) {
      valuesChanged = true
    }
  }
  if (valuesChanged){
    actions.english.push('Coordination Office was updated');
    actions.french.push('Bureau de coordination mis à jour');
  }

  //Phone
  valuesChanged = false;
  if (origContact.phone.length != contactNew.phone.length) {
    valuesChanged = true;
  }
  else {
    //Check if values changed
    if (origContact.phone.length > 0 && contactNew.phone.length > 0) {
      origContact.phone.forEach(function(value, i) {
        if (contactNew.phone[i]) {
          if (value.countryCode != contactNew.phone[i].countryCode) {
            valuesChanged = true;
          }
          if (value.number != contactNew.phone[i].number) {
            valuesChanged = true;
          }      
          if (value.type != contactNew.phone[i].type) {
            valuesChanged = true;
          }   
        }
        else {
          valuesChanged = true;
        }
      });
    }
  }
  if (valuesChanged){
    actions.english.push('Phone was updated');
    actions.french.push('Téléphone mis à jour');
  }

  //VOIP
  valuesChanged = false;
  if (origContact.voip.length != contactNew.voip.length) {
    valuesChanged = true;
  }
  else {
    //Check if values changed
    if (origContact.voip.length > 0 && contactNew.voip.length > 0) {
      origContact.voip.forEach(function(value, i) {
        if (contactNew.voip[i]) {
          if (value.number != contactNew.voip[i].number) {
            valuesChanged = true;
          }    
          if (value.type != contactNew.voip[i].type) {
            valuesChanged = true;
          }   
        }
        else {
          valuesChanged = true;
        }
      });
    }
  }
  if (valuesChanged){
    actions.english.push('Instant messenger was updated');
    actions.french.push('Messagerie instantanée mise à jour');
  }

  //Email
  valuesChanged = false;
  if (origContact.email.length != contactNew.email.length) {
    valuesChanged = true;
  }
  else {
    //Check if values changed
    if (origContact.email.length > 0 && contactNew.email.length > 0) {
      origContact.email.forEach(function(value, i) {
        if (contactNew.email[i]) {
          if (value.address != contactNew.email[i].address) {
            valuesChanged = true;
          }    
          if (value.type != contactNew.email[i].type) {
            valuesChanged = true;
          }   
        }
        else {
          valuesChanged = true;
        }
      });
    }
  }
  if (valuesChanged){
    actions.english.push('Email was updated');
    actions.french.push('Adresse émail mise à jour');
  }

  //URI
  valuesChanged = false;
  if (origContact.uri.length != contactNew.uri.length) {
    valuesChanged = true;
  }
  else {
    //Check if values changed
    if (origContact.uri.length > 0 && contactNew.uri.length > 0) {
      origContact.uri.forEach(function(value, i) {
        if (contactNew.uri[i]) {
          if (value != contactNew.uri[i]) {
            valuesChanged = true;
          }     
        }
        else {
          valuesChanged = true;
        }
      });
    }
  }
  if (valuesChanged){
    actions.english.push('Website URL was updated');
    actions.french.push('URL du site web mise à jour');
  }

  //Departure Date
  valuesChanged = false;
  if (origContact.departureDate == '' && contactNew.departureDate != ''){
    valuesChanged = true;
  }
  if (origContact.departureDate != '' && contactNew.departureDate == ''){
    valuesChanged = true;
  }
  if (origContact.departureDate && contactNew.departureDate) {
    if (Date(origContact.departureDate) != Date(contactNew.departureDate)) {
      valuesChanged = true;
    }
  }
  if (valuesChanged){
    actions.english.push('Departure date was updated');
    actions.french.push('Date de départ mise à jour');
  }

  //Notes
  if (origContact.notes != contactNew.notes) {
    actions.english.push('Notes were updated');
    actions.french.push('Notes mis à jour');
  }

  return actions;
}

function resetPasswordPost(req, res, next) {
  // Issue a request for a password reset to the auth system.
  var request = {
    'email': req.body.email || '',
    'emailFlag': req.body.emailFlag || null,
    'adminName': req.body.adminName || null
  };

  // Make sure we are not sending an invite to a non-orphan account
  Contact.findOne({'email': {$elemMatch: {address: request.email}}, 'type': 'global'}, function (err, contact) {
    if (err) {
      res.send(err);
      next();
    }
    // Email has a global profile associated to it
    if (contact !== null) {
      // Make sure the profile is an orphan
      Profile.findById(contact._profile, function (err, profile) {
        if (err) {
          res.send(err);
          next();
        }
        if (!profile.isOrphan()) {
          res.send({'status': 'error', 'message': 'Can not send a claim email to a non-orphan account'});
          next();
        }
        else {
          resetPasswordPostEmail(req, res, next, request);
        }
      });
    }
    else {
      resetPasswordPostEmail(req, res, next, request);
    }
  });
}

function resetPasswordPostEmail(req, res, next, request) {
  if (process.env.NODE_ENV == 'test') {
    res.send({'status': 'ok', 'message': 'Not testing the auth part. Mail would be sent out successfully'});
    next();
  }

  var new_access_key = middleware.require.getAuthAccessKey(request);
  request["access_key"] = new_access_key.toString();

  var client_key = config.authClientId;
  request["client_key"] = client_key

  var client = restify.createJsonClient({
    url: config.authBaseUrl,
    version: '*'
  });

  client.post("/api/resetpw", request, function(err, authReq, authRes, data) {
    client.close();

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


function notifyContact(req, res, next) {
  var mailText, mailSubject, mailOptions, mailWarning, mailInfo, adminName;
  var contactId = req.body.contactId || null;
  var result = null;

  if (contactId && req.apiAuth.mode == 'user' && req.apiAuth.userId) {
    Contact.findById(contactId, function(err, contact) {
      if (err)
        res.send(err);
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (err)
          res.send(err);
        Contact.findOne({'type': 'global', '_profile': userProfile._id}, function (err, admin) {
          if (err)
            res.send(err);
          mailOptions = {
            to: contact.mainEmail(false),
            cc: admin.mainEmail(false),
            subject: admin.fullName() + ' noticed that some of your Humanitarian ID details may need to be updated',
            recipientFirstName: contact.nameGiven,
            adminName: admin.fullName(),
            locationName: contact.location || ''
          };

          // Send mail
          mail.sendTemplate('notify_contact_' + contact.type, mailOptions, function (err, info) {
            if (err) {
              mailWarning.err = err;
              result = {status: "error", message: "Error sending email: " + mailWarning};
              log.warn(mailWarning);
            }
            else {
              mailInfo = {'type': 'notifyProblemEmail:success', 'message': 'Incorrect info email sending successful to ' + mailOptions.to + '.'};
              log.info(mailInfo);
              result = {status: "ok", message: "Email sent successfully"};
            }
            res.send(result);
            next();
          });
        });
      });

    });

  }
  else{
    result = {status: "error", message: "No email details were provided"};
    next();
  }
}

exports.post = post;
exports.postAccess = postAccess;
exports.resetPasswordPost = resetPasswordPost;
exports.notifyContact = notifyContact;
