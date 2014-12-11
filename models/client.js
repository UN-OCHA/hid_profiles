var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var Profile = mongoose.model('Profile');

var clientSchema = new mongoose.Schema({
  clientId: String,
  clientSecret: String
});

mongoose.model('Client', clientSchema);

var Client = mongoose.model('Client');
module.exports = Client;