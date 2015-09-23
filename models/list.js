var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var listSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  users:    [{type: String}],
  contacts: [ { type: Schema.Types.ObjectId, ref: 'Contact' } ],
  privacy: {type: String, required: true},
});

mongoose.model('List', listSchema);

var List = mongoose.model('List');
module.exports = List;
