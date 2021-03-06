var async = require('async'),
  _ = require('lodash'),
  mongoose = require('../models').mongoose,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  Service = require('../models').Service,
  roles = require('../lib/roles.js'),
  log = require('../log'),
  restify = require('restify'),
  middleware = require('../middleware');
  mail = require('../mail'),
  cartodb = require('cartodb');

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

function putAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all contacts.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    // Users are allowed write access only to their own contacts, unless they
    // have an administrative role.
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (err) {
          res.send(500, new Error(err));
          return next(err);
        }
        if (userProfile) {
          req.apiAuth.userProfile = userProfile;
        }

        if (userProfile.roles && userProfile.roles.length && roles.has(userProfile, /[^admin$|^manager:|^editor:]/)) {
          return next();
        }

        Contact.findById(req.params.id, function (err2, contact) {
          if (err2) {
            res.send(500, new Error(err2));
            return next(err2);
          }

          if (!contact) {
            res.send(404, new Error('Contact ' + req.params.id + ' not found'));
            return next(true);
          }

          if (userProfile._id == contact._profile) {
            return next();
          }
          else {
            res.send(403, new Error('User not authorized to update contact.'));
            return next(false);
          }
        });
      });
      return;
    }
  }
  res.send(401, new Error('Client not authorized to update contact'));
  return next(false);
}

function checkinHelper(req, res, next, stat) {
  Contact.findByIdAndUpdate(req.params.id, { $set: { 'status': stat } }, function (err, contact) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (contact) {
      res.send(200, contact);
    }
    else {
      res.send(404, new Error('Contact ' + req.params.id + ' not found'));
    }
    next();
  });
}

function checkin(req, res, next) {
  checkinHelper(req, res, next, true);
}

function checkout(req, res, next) {
  checkinHelper(req, res, next, false);
}

function post(req, res, next) {
  var contactFields = {},
    contactModel = (new Contact(req.body)).toObject(),
    parts = [];

  for (var prop in req.body) {
    if (req.body.hasOwnProperty(prop) && contactModel.hasOwnProperty(prop)) {
      if (prop === 'nameGiven' || prop === 'nameFamily') {
        parts = req.body[prop].split(" ");
        for (var i = 0; i < parts.length; i++) {
          parts[i] = parts[i].replace(/[(){}[]%_]+/g, "");
          parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substr(1).toLowerCase();
        }
        contactFields[prop] = parts.join(" ");
      }
      else {
        contactFields[prop] = req.body[prop];
      }
    }
  }
  var isNewContact = req.body.isNewContact || false;
  var notify = req.body.notify || null;
  var adminName = req.body.adminName || null;
  var adminEmail = req.body.adminEmail || null;
  var inviter = req.body.inviter || null;
  var message = null;
  var isGhost = false;
  var isNewUser = false;
  var isUserActive = false;
  var resetUrl = '';
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
    setVerifiedFlag = false,
    newVerifiedByID = false,
    setVerifiedByID = null,
    newVerifiedByName = false,
    setVerifiedByName = null,
    newVerificationDate = false,
    setVerificationDate = null,
    tempData = null,
    setKeyContact = false,
    setProtectedRoles = false,
    newProtectedRoles = [],
    setProtectedBundles = false,
    newProtectedBundles = [],
    setOrgEditorRoles = false,
    inviterRequest = null,
    setDailyDigest = false,
    newDailyDigest = false;

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
      else {
        //New contact
        if (isNewContact && (!contactFields.email[0].address || !contactFields.email[0].address.length)){
          //This is a ghost account (no email) so create a new userid
          userid =  Date.now();
          isGhost = true;
        }
        return cb();
      }
    },
    // Check to see if the user exists on the auth side
    function (cb) {
      var request = {
        "userid": userid
      };
      var new_access_key = middleware.require.getAuthAccessKey(request);
      request["access_key"] = new_access_key.toString();

      var client_key = process.env.AUTH_CLIENT_ID;
      request["client_key"] = client_key

      var client = restify.createJsonClient({
        url: process.env.AUTH_BASE_URL,
        version: '*'
      });
      client.post("/api/users", request, function (err, req, res, data) {
        client.close();
        if (res.statusCode == 200 && res.body) {
          var obj = JSON.parse(res.body);
          if (obj.status && obj.status == 'error') {
            // Assume no user was found
            isNewUser = true;
            return cb();
          }
          else if (obj.user_id) {
            userid = obj.user_id;
            if (obj.active) {
              isUserActive = true;
            }
            else {
              resetUrl = obj.reset_url;
            }
            return cb();
          }
        }
        log.warn({'type': 'contactSave:error', 'message': 'contactSave: An unsuccessful response was received when trying to retrieve a user account on the authentication service.', 'req': req, 'res': res});
        result = {status: "error", message: "Could not retrieve user account. Please try again or contact an administrator."};
        return cb(true);
      });
    },
    function (cb) {
      // If invitation sent on behalf of local admin/inviter
      if (inviter && inviter.profileid) {
        Contact.findOne({'type': 'global', '_profile': inviter.profileid}, function (err, contact) {
          if (!err && contact) {
            inviterRequest = {};
            inviterRequest.name = contact.nameGiven + ' ' + contact.nameFamily;
            inviterRequest.email = contact.email[0].address;
          }
          return cb();
        });
      }
      else {
        return cb();
      }
    },
    function (cb) {
      if (isNewUser && contactFields.status == 1) {
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
          'emailFlag': '1',
          'expires': contactFields.expires ? contactFields.expires : false,
          'expiresAfter': contactFields.expiresAfter ? contactFields.expiresAfter : 0 //Orphan email
        };
        if (inviterRequest) {
          request.inviter = inviterRequest;
        }

        var new_access_key = middleware.require.getAuthAccessKey(request);
        request["access_key"] = new_access_key.toString();

        var client_key = process.env.AUTH_CLIENT_ID;
        request["client_key"] = client_key

        var client = restify.createJsonClient({
          url: process.env.AUTH_BASE_URL,
          version: '*'
        });

        client.post("/api/register", request, function(err, req, res, data) {
          client.close();

          if (res.statusCode == 200 && res.body) {
            var obj = JSON.parse(res.body);
            if (obj && obj.data && obj.data.user_id) {
              // Set userid to the userid returned from the auth service
              userid =  obj.data.user_id;
              return cb();
            }
          }
          log.warn({'type': 'contactSave:error', 'message': 'contactSave: An unsuccessful response was received when trying to create a user account on the authentication service.', 'req': req, 'res': res});
          result = {status: "error", message: "Could not create user account. Please try again or contact an administrator."};
          return cb(true);
        });
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
        if (isNewContact && !isGhost && !contactFields.expires){
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
            var upProfile = {
              userid: userid,
              status: 1,
              expires: contactFields.expires ? contactFields.expires : false,
              expiresAfter: contactFields.expiresAfter ? contactFields.expiresAfter : 0
            };
            Profile.update({userid: userid}, upProfile, {upsert: true}, function(err, profile) {
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
    // Make sure a contact of this type does not already exist for the profile
    function (cb) {
      if (!contactFields._id) { // We are creating a new contact
        if (contactFields.type == 'global') {
          Contact.findOne({'type': 'global', '_profile': _profile, 'status': 1}, function (err, doc) {
            if (!err && doc) {
              // Contact already exists
              result = {status: 'error', message: 'A global profile for this profile already exists'};
              return cb(true);
            }
            return cb();
          });
        }
        else if (contactFields.type == 'local') {
          if (contactFields.locationId) {
            Contact.findOne({'type': 'local', '_profile': _profile, 'locationId': contactFields.locationId, 'status': 1}, function (err, doc) {
              if (!err && doc) {
                result = {status: 'error', message: 'A local contact for this profile in this country already exists'};
                return cb(true);
              }
              return cb();
            });
          }
          else {
            result = {status: 'error', message: 'Can not create a local contact without a locationId'};
            return cb(true);
          }
        }
      }
      else {
        return cb();
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
        if (origProfile && (origProfile.verified != req.body.verified || !origProfile.verified)) {
          setVerified = true;
          setVerifiedFlag = true;
          newVerified = req.body.verified;
        }
      }

      if (req.body.hasOwnProperty("dailyDigest") ) {
        setDailyDigest = true;
        newDailyDigest = req.body.dailyDigest;
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
        if (userProfile && userProfile.orgEditorRoles && newOrgEditorRoles ){
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

      // Set remindedCheckout to false when changing the departureDate on an existing contact
      // This handles the case where a user changes his departure date after receiving a reminder_checkout email
      if (existingContact && origContact.departureDate && origContact.departureDate.toISOString() != contactFields.departureDate) {
        contactFields.remindedCheckout = false;
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
          if (contactFields.type == 'local') {
            Contact.findById(upsertId, function (err2, contact) {
              if (!err2 && contact) {
                // Add the contact in cartodb
                // Get the corresponding location
                var restclient = restify.createJsonClient({
                  url: process.env.HRINFO_BASE_URL
                });
           
                var op_id = contact.locationId.replace('hrinfo:', '');
                restclient.get('/api/v1.0/operations/' + op_id, function (err3, req1, res1, obj) {
                  if (!err && obj.data && obj.data.length) {
                    if (obj.data[0].country) {
                      var lat = obj.data[0].country.geolocation.lat;
                      var lon = obj.data[0].country.geolocation.lon;
                      var org_name = contact.organization[0] && contact.organization[0].name ? contact.organization[0].name.replace("'", "''") : '';
                      var origin_location = contact.address[0] && contact.address[0].country ? contact.address[0].country.replace("'", "''") : '';
                      var location_country = obj.data[0].country.label ? obj.data[0].country.label.replace("'", "''") : '';
                      var created = new Date(contact.created);
                      var sql_query = "INSERT INTO " + process.env.CARTODB_TABLE + " (the_geom, hid_id, org_name, last_updated, origin_location, location_country, operation_id) VALUES (";
                      sql_query = sql_query + "'SRID=4326; POINT (" + lon + " " + lat + ")', '" + contact._id.toString() + "', '" + org_name + "', '" + created.toISOString() + "', '" + origin_location + "', '" + location_country + "', '" + op_id + "')";
                      // Execute the cartodb query
                      var csql = new cartodb.SQL({ user: process.env.CARTODB_DOMAIN, api_key: process.env.CARTODB_API_KEY});
                      csql.execute(sql_query);
                    }
                  }
                });
              }
            });
          }
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
              tempData = profile;
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
    function (cb) {
    
        if(setVerifiedFlag)
        {
            Contact.findOne({'_profile': req.apiAuth.userProfile._id, 'type': 'global'}, function (err, profile) {
            tempData.verifiedByID = profile._id;
            var name = profile.nameGiven + " " + profile.nameFamily;
            tempData.verifiedByName = name;
            tempData.verificationDate = Date.now();

            return tempData.save(function (err, tempData, num) {
              log.info({'type': 'contactSave:success', 'message': "Updated profile " + _profile });
              return cb(err);
            });
          });
        }
        else{
          return cb();
        }
      
    },
    //the save for the local daily digest for a country....
    function (cb){
      if(setDailyDigest){
        Profile.findOne({_id: _profile}, function (err, profile) {
          if (!err && profile) {
            profile.dailyDigest = newDailyDigest;
            return profile.save(function (err, profile, num) {
              log.info({'type': 'contactSave:success', 'message': "Updated daily digest settings for profile  " + _profile });
              return cb(err);
            });
          }
          else {
            return cb(err);
          }
        });
        return cb();
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
    // Subscribe to automated services
    function (cb) {
      var mailOptions = {};
      // If checking in
      if (contactFields.type == 'local' && contactFields.status === 1 && contactFields.email[0] && contactFields.email[0].address) {
        if (!origContact || (origContact && origContact.status === 0)) {
          var merge_vars = {
            fname: contactFields.nameGiven,
            lname: contactFields.nameFamily
          };
          Service.find({ status: true, auto_add: true, 'locations.remote_id': contactFields.locationId }, function (err, services) {
            services.forEach(function (service, i) {
              service.subscribe(origProfile, contactFields.email[0].address, merge_vars, function (data) {
                if (data) {
                  // Send email to notify user
                  mailOptions = {
                    to: contactFields.email[0].address,
                    subject: 'You were automatically subscribed to ' + service.name + ' on Humanitarian ID',
                    recipientFirstName: contactFields.nameGiven,
                    serviceName: service.name
                  };
                  mail.sendTemplate('auto_subscribe', mailOptions);
                }
              });
            });
            return cb();
          });
        }
        else {
          return cb();
        }
      }
      // If checking out
      else if (contactFields.status === 0) {
        if (origContact && origContact.status === true) {
          Service.find({ status: true, auto_remove: true, 'locations.remote_id': origContact.locationId }, function (err, services) {
            services.forEach(function (service, i) {
              service.unsubscribe(origProfile, function (data) {
                // send email to tell user he was unsubscribed
                if (data) {
                  mailOptions = {
                    to: data,
                    subject: 'You were automatically unsubscribed from ' + service.name + ' on Humanitarian ID',
                    recipientFirstName: origContact.nameGiven,
                    serviceName: service.name
                  };
                  mail.sendTemplate('auto_unsubscribe', mailOptions);
                }
              });
            });
            return cb();
          });
        }
        else {
          return cb();
        }
      }
      else {
        return cb();
      }
    },
    // Send emails (if applicable)
    function (cb) {
      var isOwnProfile = req.apiAuth.userId && req.apiAuth.userId === req.body.userid;
      if (!isOwnProfile && notify == true) {
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
        if (emailContact.email.length && emailContact.email[0].address) {
          notifyEmail.recipientEmail = emailContact.email[0].address;
        }
        notifyEmail.recipientFirstName = emailContact.nameGiven;
        notifyEmail.locationName = emailContact.location || '';
        notifyEmail.locationType = emailContact.type;
        notifyEmail.locationId = emailContact.locationId || '';
        notifyEmail.adminName = adminContact.fullName();
        notifyEmail.adminEmail = adminContact.mainEmail(false);
        
        if (notifyEmail.recipientEmail && (notifyEmail.type == 'notify_edit' || (notifyEmail.type == 'notify_checkin' && !isNewUser) || notifyEmail.type == 'notify_checkout')) {
          var mailText, mailSubject, mailOptions, mailWarning, mailInfo, actions, actionsEN, actionsFR, actionsFound, templateName;

          actions = [];
          actionsEN = [];
          actionsFR = [];
          actionsFound = false;

          switch(notifyEmail.type) {
            case 'notify_checkin':
              mailSubject = 'You have been checked into ' + notifyEmail.locationName + ' on Humanitarian ID';
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
            actionsFR: actionsFR,
            isUserActive: isUserActive,
            reset_url: resetUrl
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
    var newCheck = [], origCheck = [];
    origContact.disasters.forEach(function(value, i) {
      newCheck = contactNew.disasters.filter(function (elt) {
        if (elt.remote_id == value.remote_id) {
          return elt;
        }
      });
      if (newCheck.length == 0) {
        disastersRemoved.push(value.name);
      }
      newCheck = [];
    });
    contactNew.disasters.forEach(function (value, i) {
      origCheck = origContact.disasters.filter(function (elt) {
        if (elt.remote_id == value.remote_id) {
          return elt;
        }
      });
      if (origCheck.length == 0) {
        disastersAdded.push(value.name);
      }
      origCheck = [];
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
    var actionEn, actionFr;
    actionEn = 'Your current location was updated to ';
    actionFr = 'Votre lieu actuel a été mis à jour: ';
    if (contactNew.address[0].locality) {
      actionEn += contactNew.address[0].locality + ', ';
      actionFr += contactNew.address[0].locality + ', ';
    }
    if (contactNew.address[0].administrative_area) {
      actionEn += contactNew.address[0].administrative_area + ', ';
      actionFr += contactNew.address[0].administrative_area + ', ';
    }
    actionEn += contactNew.address[0].country;
    actionFr += contactNew.address[0].country;
    actions.english.push(actionEn);
    actions.french.push(actionFr);
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
    actions.english.push('Coordination Office was updated to ' + contactNew.office[0].name);
    actions.french.push('Bureau de coordination mis à jour: ' + contactNew.office[0].name);
  }

  //Phone
  valuesChanged = false;
  if (origContact.phone.length != contactNew.phone.length && contactNew.phone.length != 0) {
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
    var phonesRaw = new Array();
    contactNew.phone.forEach(function (value, i) {
      phonesRaw.push(' ' + value.type + ': ' + value.number);
    });
    actions.english.push('Phones were updated to ' + phonesRaw.toString());
    actions.french.push('Téléphones mis à jour: ' + phonesRaw.toString());
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
    var ims = new Array();
    contactNew.voip.forEach(function (value, i) {
      ims.push(' ' + value.type + ': ' + value.number);
    });
    actions.english.push('Instant messenger was updated to ' + ims.toString());
    actions.french.push('Messagerie instantanée mise à jour: ' + ims.toString());
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
    var emails = new Array(),
        emtemp;
    contactNew.email.forEach(function (value, i) {
      emtemp = ' ';
      if (value.type) {
        emtemp += value.type + ': ';
      }
      emtemp += value.address;
      emails.push(emtemp);
    });
    actions.english.push('Email addresses were updated to ' + emails.toString());
    actions.french.push('Adresses emails mises à jour ' + emails.toString());
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
    actions.english.push('Website URLs were updated to ' + contactNew.uri.toString());
    actions.french.push('URLs de sites webs mises à jour: ' + contactNew.uri.toString());
  }

  //Departure Date
  valuesChanged = false;
  if (origContact.type == 'local') {
    var origDep = new Date(origContact.departureDate),
        newDep = new Date(contactNew.departureDate);
    if (origDep.valueOf() != newDep.valueOf() && newDep.valueOf() != 0){
      valuesChanged = true;
    }
    if (valuesChanged){
      var dateOptions = { day: "numeric", month: "long", year: "numeric" };
      actions.english.push('Departure date was updated to ' + newDep.toLocaleDateString('en', dateOptions));
      actions.french.push('Date de départ mise à jour au ' + newDep.toLocaleDateString('fr', dateOptions));
    }
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

  var client_key = process.env.AUTH_CLIENT_ID;
  request["client_key"] = client_key

  var client = restify.createJsonClient({
    url: process.env.AUTH_BASE_URL,
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
exports.putAccess = putAccess;
exports.checkin = checkin;
exports.checkout = checkout;
