var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var Profile = mongoose.model('Profile');


// Define sub-schemas
var emailSchema = new Schema({
  address:  String,
  type:     String,
  content:  String
});

var phoneSchema = new Schema({
  number:       String, // no dashes or formatting
  countryCode:  String, // ex: "+1",
  type:         [ String ]
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
  fulltext:                 String, // "1313 Mockingbird Lane\nSuite 6\nNYC, NY 12345", use \n for newlines
});

var uriSchema = new Schema({
  type:   String,
  uri:    String,
  label:  String,
});

var organizationSchema = new Schema({
  remote_id:  String,
  name:       String
});

var contactSchema = new mongoose.Schema({
  _profile:           { type: Schema.Types.ObjectId, ref: 'Profile' }, // links to "parent" Profile document (required)
  type:               String, //"local" or "global"
  location:           String, // "Liberia - Ebola crisis" or "Global"
  email:              [ emailSchema ],
  phone:              [ phoneSchema ],
  address:            [ addressSchema ],
  uri:                [ uriSchema ],
  organization:       [ organizationSchema ],
  jobtitle:           String,
  notes:              String,
});

mongoose.model('Contact', contactSchema);

var Contact = mongoose.model('Contact');
module.exports = Contact;