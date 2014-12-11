var config = require('./../config');
var mongoose = require('mongoose');

mongoose.connect(config.db);

module.exports.Profile = require('./profile');
module.exports.Contact = require('./contact');
module.exports.Client = require('./client');
module.exports.mongoose = mongoose;
