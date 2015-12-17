var mongoose = require('mongoose'),
    Profile = require('../models').Profile;
var Schema = mongoose.Schema;

var validType = {
  values: 'mailchimp googlegroup'.split(' '),
  message: '{VALUE} is not a valid service type.'
};

var serviceSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  type:     {type: String, required: true, enum: validType},
  mc_api_key: {type: String},
  mc_list: { id: String, name: String},
  googlegroup: {
    domain: { type: String },
    group: { id: String, name: String }
  },
  status: { type: Boolean, default: true},
  hidden: { type: Boolean, default: false},
  locations: [ { name: String, remote_id: String } ],
  owners: [ { type: Schema.Types.ObjectId, ref: 'Profile' } ]
});

serviceSchema.pre('remove', function (next) {
  Profile.find({'subscriptions.service': this }, function (err, profiles) {
    if (err) {
      return next(err);
    }
    if (!profiles.length) {
      return next();
    }
    profiles.each(function (err2, profile) {
      if (!err2 && profile && profile.subscriptions && profile.subscriptions.length) {
        var index = -1;
        for (var i = 0; i < profile.subscriptions.length; i++) {
          if (profile.subscriptions[i].service.equals(this._id)) {
            index = i;
          }
        }
        profile.subscriptions.splice(index, 1);
        profile.save();
      }
      else {
        return next(err2);
      }
    });
    return next();
  });
});


// Sanitize service before presenting it to non admin users
serviceSchema.methods.sanitize = function() {
  this.mc_api_key = undefined;
};

mongoose.model('Service', serviceSchema);

var Service = mongoose.model('Service');
module.exports = Service;
