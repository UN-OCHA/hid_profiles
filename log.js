var bunyan = require('bunyan'),
  log = bunyan.createLogger({
    name: process.env.APP_NAME,
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
