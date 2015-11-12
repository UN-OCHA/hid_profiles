var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var validType = {
  values: 'mailchimp'.split(' '),
  message: '{VALUE} is not a valid service type.'
};

var serviceSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  type:     {type: String, required: true, enum: validType},
  mc_api_key: {type: String},
  mc_list: { id: String, name: String}
});

// Sanitize service before presenting it to non admin users
serviceSchema.methods.sanitize = function() {
  this.mc_api_key = undefined;
};

mongoose.model('Service', serviceSchema);

var Service = mongoose.model('Service');
module.exports = Service;
