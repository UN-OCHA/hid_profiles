var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var profileSchema = new mongoose.Schema({
  userid:       String,
  nameFamily:   String,
  nameGiven:    String,
  email:        String,
  ochaContent:  { topics: [ String ] },
  created:      Number, // timestamp
  revised:      Number, // timestamp
  status:       Boolean
});

mongoose.model('Profile', profileSchema);

var Profile = mongoose.model('Profile');
module.exports = Profile;