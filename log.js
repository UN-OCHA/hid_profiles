var bunyan = require('bunyan'),
  config = require('./config'),
  log = bunyan.createLogger({
    name: config.name,
    serializers: {
      req: bunyan.stdSerializers.req
    },
    streams: [
      {
        level: 'info',
        stream: process.stdout
      },
      {
        level: 'info',
        path: '/var/log/hid_profiles.log'
      }
    ]
  });

module.exports = log;
