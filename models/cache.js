var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var cacheSchema = new mongoose.Schema({
  name: String,
  data: Object
});

mongoose.model('Cache', cacheSchema);

var Cache = mongoose.model('Cache');
module.exports = Cache;