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
  subscriptions:      [ { type: Schema.Types.ObjectId, ref: 'Service' }]
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
  if (this.subscriptions && this.subscriptions.length && this.subscriptions.indexOf(service) != -1) {
    return true;
  }
  else {
    return false;
  }
};

// Subscribe a user to a service
// TODO: do the real subscription
profileSchema.methods.subscribe = function (service) {
  if (!this.subscriptions) {
    this.subscriptions = [];
  }
  this.subscriptions.push(service);
  this.save();
};

// Unsubscribe the user from the service
// TODO: do the real unsubscribe from service
profileSchema.methods.unsubscribe = function (service) {
  var index = this.subscriptions.indexOf(service._id);
  if (index > -1) {
    this.subscriptions.splice(index, 1);
  }
  this.save();
};

mongoose.model('Profile', profileSchema);

var Profile = mongoose.model('Profile');
module.exports = Profile;

