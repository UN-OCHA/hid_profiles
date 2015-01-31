var config = require('./../config');
var mongoose = require('mongoose');

mongoose.connect(config.db);

module.exports.Profile = require('./profile');
module.exports.Contact = require('./contact');
module.exports.Client = require('./client');
module.exports.Cache = require('./cache');
module.exports.mongoose = mongoose;
