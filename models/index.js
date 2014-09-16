var config = require('./../config');
var mongoose = require('mongoose');

mongoose.connect(config.db);

module.exports.Profile = require('./profile');
module.exports.mongoose = mongoose;
