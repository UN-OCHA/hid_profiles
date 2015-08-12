var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var contactListSchema = new Schema({
  name:     String,
  contacts: [ { type: Schema.Types.ObjectId, ref: 'Contact' } ],
});

var orgEditorRoleSchema = new Schema({
  locationId:         String,
  organizationId:     String,
  organizationName:   String,
});

var profileSchema = new mongoose.Schema({
  userid:             String,
  nameFamily:         String,
  nameGiven:          String,
  email:              String,
  ochaContent:        { topics: [ String ] },
  created:            Number, // timestamp
  revised:            Number, // timestamp
  firstUpdate:        Number, // timestamp
  status:             Boolean,
  _contacts:          [{ type: Schema.Types.ObjectId, ref: 'Contact' }],
  roles:              [ String ],
  orgEditorRoles:     [ orgEditorRoleSchema ],
  verified:           Boolean,
  contactLists:       [ contactListSchema ],
});

profileSchema.methods.isOrphan = function() {
  if (this.firstUpdate) {
    return false;
  }
  else {
    return true;
  }
};

mongoose.model('Profile', profileSchema);

var Profile = mongoose.model('Profile');
module.exports = Profile;

