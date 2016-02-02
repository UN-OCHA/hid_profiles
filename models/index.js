var mongoose = require('mongoose');

mongoose.connect(process.env.DATABASE);

module.exports.Profile = require('./profile');
module.exports.Contact = require('./contact');
module.exports.Client = require('./client');
module.exports.List = require('./list');
module.exports.Cache = require('./cache');
module.exports.ServiceCredentials = require('./serviceCredentials');
module.exports.Service = require('./service');
module.exports.mongoose = mongoose;
