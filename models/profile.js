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
  subscriptions:      [ {service: {type: Schema.Types.ObjectId, ref: 'Service'}, email: String} ]
});

profileSchema.methods.isOrphan = function() {
  if (this.firstUpdate) {
    return false;
  }
  else {
    return true;
  }
};

// Check if a user is subscribed to a service
profileSchema.methods.isSubscribed = function (service) {
  if (this.subscriptions && this.subscriptions.length) {
    var found = this.subscriptions.filter(function (item) {
      return item.service.equals(service._id);
    });
    return found.length ? true : false;
  }
  else {
    return false;
  }
};

mongoose.model('Profile', profileSchema);

var Profile = mongoose.model('Profile');
module.exports = Profile;

