var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var profileSchema = new mongoose.Schema({
  userid:       String,
  fullname:     String,
  givenname:    String,
  familyname:   String,
  jobtitle:     String,
  organization: String,
  phone:        String,
  email:        String,
});

mongoose.model('Profile', profileSchema);

var Profile = mongoose.model('Profile');
module.exports = Profile;


