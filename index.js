#!/usr/bin/env node
var P = require('bluebird');
var fetch = require('node-fetch');
var fs = P.promisifyAll(require('fs'));
var qs = require('qs');
var debug = require('debuglog')('slack-age-collector');

var previous = fs.readFileAsync('data.json', 'utf-8').then(JSON.parse).catch(function() {
  return {};
});

var current = P.resolve('https://slack.com/api/channels.list?' + qs.stringify({
    exclude_archived: 1,
    token: process.env.SLACK_TOKEN
  })).then(fetch).then(function(res) {
  return res.json();
}).then(function(body) {
  if (!body.ok)
    throw new Error(body.error);
  return body.channels;
}).map(function(channel) {
  debug("Getting channel info for %j", channel.name);
  return P.resolve(fetch('https://slack.com/api/channels.info?' + qs.stringify({
      channel: channel.id,
      token: process.env.SLACK_TOKEN
    }))).then(function(res) {
    return res.json();
  }).tap(function(body) {
    if (!body.ok)
      throw new Error(body.error);
  });
}).map(function(e) {
  if (e.channel.latest) {
    return e.channel;
  } else {
    return getLatestFor(e.channel);
  }
}).reduce(function(a, e) {
  a[e.id] = e; return a;
}, {});

function getLatestFor(channel) {
  debug("Getting latest for %j", channel.name);
  return fetch('https://slack.com/api/channels.history?' + qs.stringify({
      channel: channel.id,
      token: process.env.SLACK_TOKEN
    })).then(function(res) {
    return res.json();
  }).then(function(history) {
    if (!history.ok)
      throw new Error(history.error);
    if (history.messages[0]) {
      debug("Got latest for %j: %j", channel.name, history.messages[0]);
      channel.latest = history.messages[0];
    } else {
      debug("No messages in %j", channel.name);
    }
    return channel;
  });
}

P.join(previous, current).spread(function(prev, cur) {
  Object.keys(cur).forEach(function(id) {
    if (!cur[id].latest) {
      debug("Carrying timestamp for %j forward", cur[id].name);
      cur[id].latest = {
        ts: latest(prev[id])
      };
    }
  });

  return cur;
}).then(function(cur) {
  return fs.writeFileAsync('data.json', JSON.stringify(cur)).then(function() {
    return Object.keys(cur).reduce(function(a, id) {
      a.push(cur[id]);

      return a;
    }, []);
  });
}).filter(function(e) {
  return latest(e) < (now() - days(14));
}).then(function(idle) {
  idle.forEach(function(channel) {
    console.log(channel.id, channel.name, (now() - channel.latest.ts) / 86400 | 0);
  });
}).catch(function(e) {
  console.warn(e.stack);
  process.exit(1);
});

function latest(ent) {
  return ent && ent.latest && ent.latest.ts || now();
}

function days(n) {
  return n * 86400;
}

function now() {
  return Date.now() / 1000;
}
