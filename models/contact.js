var mongoose = require('mongoose');
var cache = require('./cache'),
    operations = require('../lib/operations'),
    phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
var Schema = mongoose.Schema;
var Profile = mongoose.model('Profile');


// Define sub-schemas
var disasterSchema = new Schema({
  remote_id:  String,
  glide_id:   String,
  name:       String
});

var emailSchema = new Schema({
  address:  String,
  type:     String,
  content:  String
});

var phoneSchema = new Schema({
  number:       String, // no dashes or formatting
  countryCode:  String, // ex: "+1",
  type:         String
});

var addressSchema = new Schema({
  type:                     String, // ex: "home" or "work",
  country:                  String, // (always required, 2 character ISO code)
  administrative_area:      String, // (ISO code when available)
  sub_administrative_area:  String,
  locality:                 String, // City or Town
  dependent_locality:       String,
  postal_code:              String,
  thoroughfare:             String,
  premise:                  String, // Apartment, Suite, Box number, etc.
  sub_premise:              String,
  fulltext:                 String  // "1313 Mockingbird Lane\nSuite 6\nNYC, NY 12345", use \n for newlines
});

var organizationSchema = new Schema({
  remote_id:           String,
  name:                String,
  org_type_name:       String,
  org_type_remote_id:  String
});

var imageSchema = new Schema({
  type:           String,
  socialMediaId:  String,
  url:            String
});

var contactSchema = new mongoose.Schema({
  _profile:           { type: Schema.Types.ObjectId, ref: 'Profile' }, // links to "parent" Profile document (required)
  type:               String, // "local" or "global"
  location:           String, // "Liberia - Ebola crisis" or "Global"
  locationId:         String,
  disasters:          [ disasterSchema ],
  nameGiven:          String,
  nameFamily:         String,
  email:              [ emailSchema ],
  phone:              [ phoneSchema ],
  voip:               [ phoneSchema ],
  address:            [ addressSchema ],
  uri:                [ String ],
  organization:       [ organizationSchema ],
  jobtitle:           String,
  bundle:             [ String ],
  protectedBundles:   [ String ],
  notes:              String,
  created:            Number, // timestamp
  revised:            Number, // timestamp
  status:             Boolean,
  keyContact:         Boolean,
  protectedRoles:     [ String ],
  image:              [ imageSchema ],
  office:             [ organizationSchema ],
  departureDate:      Date,
  remindedCheckout:   Boolean,
  remindedCheckoutDate: Date,
  remindedCheckin:    Number, //timestamp
  remindedUpdate: Number // timestamp
});

contactSchema.methods.fullName = function() {
  return this.nameGiven + " " + this.nameFamily;
};

contactSchema.methods.mainEmail = function(emailOnly) {
  if (this.email.length > 0) {
    if (typeof emailOnly === 'undefined' || emailOnly == true) {
      return this.email[0].address;
    }
    else {
      return this.fullName() + " <" + this.email[0].address + ">";
    }
  }
  else {
    return '';
  }
};

// checkout contact
contactSchema.methods.checkout = function(cb) {
  this.status = false;
  this.save(cb);
};

// Whether we should send a reminder checkout email to a contact
contactSchema.methods.shouldSendReminderCheckout = function() {
  if (!this.departureDate || (this.remindedCheckout && this.remindedCheckout == true) || this.type != 'local' || this.status == false) {
    return false;
  }
  var current = Date.now();
  var dep = new Date(this.departureDate);
  if (current.valueOf() - dep.valueOf() > 48 * 3600 * 1000) {
    return true;
  }
  return false;
};

// Whether we should do an automated checkout of a contact
contactSchema.methods.shouldDoAutomatedCheckout = function() {
  if (!this.remindedCheckout || this.remindedCheckout == false || !this.remindedCheckoutDate || this.type != 'local' || this.status == false) {
    return false;
  }
  var current = Date.now();
  var remindedCheckoutDate = new Date(this.remindedCheckoutDate);
  if (current.valueOf() - remindedCheckoutDate.valueOf() > 12 * 3600 * 1000) {
    return true;
  }
  return false;
};

// Set remindedCheckout to false when changing the departureDate on an existing contact
// This handles the case where a user changes his departure date after receiving a reminder_checkout email
contactSchema.path('departureDate').set(function (newVal) {
  if (this.departureDate && this.departureDate != newVal) {
    this.remindedCheckout = false;
  }
  return newVal;
});

// Whether the contact has a local phone number entered or not
contactSchema.methods.hasLocalPhoneNumber = function(callback) {
  if (this.type != 'local' || !this.phone || this.phone.length == 0) {
    callback(null, false);
    return;
  }
  var that = this;
  operations.getAll(function (err, operations) {
    if (err) {
      callback(err);
      return;
    }
    if (operations) {
      var op = operations[that.locationId];
      if (op) {
        var found = false;
        that.phone.forEach(function(item) {
          try {
            var phoneNumber = phoneUtil.parse(item.number);
            var regionCode = phoneUtil.getRegionCodeForNumber(phoneNumber);
            if (regionCode.toLowerCase() == op.pcode) {
              found = true;
            }
          }
          catch (err) {
            console.log(err);
          }
        });
        callback(null, found);
        return;
      }
      else {
        callback('Operation was not found', false);
        return;
      }
    }
    else {
      callback('No operations found');
      return;
    }
  });
};

// Whether the contact is in country or not
contactSchema.methods.isInCountry = function () {
  if (this.type != 'local' || !this.status || !this.address || this.address.length == 0) {
    return false;
  }
  return this.address[0].country == this.location;
};

// Whether we should send a reminder checkin email
contactSchema.methods.shouldSendReminderCheckin = function(callback) {
  var d = new Date();
  var offset = d.valueOf();
  if (this.created) {
    offset = d.valueOf() - this.created;
  }
  else {
    // Take May 7 as created date, because this is when the code to handle the created date was added
    var may = new Date(2015, 05, 07, 01, 0, 0, 0);
    offset = d.valueOf() - may;
  }
  if (this.type != 'local' || !this.status || this.remindedCheckin || offset < 48 * 3600 * 1000) {
    return callback(null, false);
  }
  if (this.isInCountry() && this.address[0].administrative_area) {
    // Should we check for offices ?
    var that = this;
    operations.getAppData(function (err, data) {
      if (err) {
        return callback(err);
      }
      if (data && data.operations) {
        var op = data.operations[that.locationId];
        if (op) {
          var count_offices = Object.keys(op.offices).length;
          if (count_offices == 0 || (count_offices > 0 && that.office && that.office.length)) {
            that.hasLocalPhoneNumber(function (err, out) {
              if (err) {
                return callback(err);
              }
              var send = !out;
              return callback(null, send);
            });
          }
          else {
            return callback(null, true);
          }
        }
        else {
          return callback('Could not find operation ' + that.location);
        }
      }
      else {
        return callback('Error retrieving operations');
      }
    });
  }
  else {
    return callback(null, true);
  }
};

// Whether we should send an update reminder (sent out after a contact hasn't been updated for 6 months)
contactSchema.methods.shouldSendReminderUpdate = function () {
  if (this.type != 'local' || this.status != true || (!this.created && !this.revised)) {
    return false;
  }
  var d = new Date();
  var revised_offset = d.valueOf();
  if (this.revised) {
    revised_offset = d.valueOf() - this.revised;
  }
  else {
    revised_offset = d.valueOf() - this.created;
  }
  if (revised_offset < 183 * 24 * 3600 * 1000) { // if not revised during 6 months
    return false;
  }
  if (this.remindedUpdate) {
    var reminded_offset = d.valueOf() - this.remindedUpdate;
    if (reminded_offset < 183 * 24 * 3600 * 1000) {
      return false;
    }
  }
  return true;
};

mongoose.model('Contact', contactSchema);

var Contact = mongoose.model('Contact');
module.exports = Contact;
