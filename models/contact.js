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
  remote_id:  String,
  name:       String
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
  notes:              String,
  created:            Number, // timestamp
  revised:            Number, // timestamp
  status:             Boolean,
  keyContact:         Boolean,
  protectedRoles:     [ String ]
});

mongoose.model('Contact', contactSchema);

var Contact = mongoose.model('Contact');
module.exports = Contact;
