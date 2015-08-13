var mongoose = require('mongoose');
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
  remindedCheckoutDate: Date
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
  this.status = 0;
  this.save(cb);
};

// Whether we should send a reminder checkout email to a contact
contactSchema.methods.shouldSendReminderCheckout = function() {
  if (!this.departureDate || (this.remindedCheckout && this.remindedCheckout == true) || this.type != 'local' || this.status == 0) {
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
  if (!this.remindedCheckout || this.remindedCheckout == false || !this.remindedCheckoutDate || this.type != 'local' || this.status == 0) {
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

mongoose.model('Contact', contactSchema);

var Contact = mongoose.model('Contact');
module.exports = Contact;
