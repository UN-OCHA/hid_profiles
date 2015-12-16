var mongoose = require('mongoose'),
    Profile = require('../models').Profile;
var Schema = mongoose.Schema;

var validType = {
  values: 'googlegroup'.split(' '),
  message: '{VALUE} is not a valid service credentials type.'
};

var serviceCredentialsSchema = new Schema({
  type:     {type: String, required: true, enum: validType},
  googlegroup: { 
    domain: { type: String },
    secrets: Schema.Types.Mixed,
    token: Schema.Types.Mixed
  }
});

mongoose.model('ServiceCredentials', serviceCredentialsSchema);

var ServiceCredentials = mongoose.model('ServiceCredentials');
module.exports = ServiceCredentials;
