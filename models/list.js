var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var validPrivacy = {
  values: 'inlist me all verified some'.split(' '),
  message: '{VALUE} is not a valid privacy setting.'
};

var listSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  users:    [{type: String}],
  contacts: [ { type: Schema.Types.ObjectId, ref: 'Contact' } ],
  privacy: {type: String, required: true, enum: validPrivacy},
  readers:  [ { type:Schema.Types.ObjectId, ref: 'Profile' } ],
  editors: [ { type: Schema.Types.ObjectId, ref: 'Profile' } ]
});

mongoose.model('List', listSchema);

var List = mongoose.model('List');
module.exports = List;
