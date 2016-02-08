var mongoose = require('mongoose'),
  Profile = require('../models').Profile,
  Contact = require('../models').Contact;
var Schema = mongoose.Schema;

var validPrivacy = {
  values: 'inlist me all verified some'.split(' '),
  message: '{VALUE} is not a valid privacy setting.'
};

var listSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  users:    [{type: String}],
  contacts: [ { type: Schema.Types.ObjectId, ref: 'Contact' } ],
  privacy: {type: String, required: true, enum: validPrivacy},
  readers:  [ { type:Schema.Types.ObjectId, ref: 'Profile' } ],
  editors: [ { type: Schema.Types.ObjectId, ref: 'Profile' } ]
});

listSchema.methods.getOwnerName = function(cb) {
  Profile.findOne({ userid: this.userid }, function (err, profile) {
    if (err) {
      return cb(err);
    }
    if (!profile) {
      return cb(new Error('Could not find profile'));
    }
    Contact.findOne({type: 'global', _profile: profile._id}, cb);
  });
};

mongoose.model('List', listSchema);
var List = mongoose.model('List');
module.exports = List;
