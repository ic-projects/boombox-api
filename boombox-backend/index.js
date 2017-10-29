var MongoClient = require('mongodb').MongoClient;
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var uuidv4 = require('uuid/v4');

let init = async function() {
    var db = await MongoClient.connect('mongodb://localhost:27017/boombox');
    console.log('Connected correctly to server');

    // Create parties collection if needed
    let partiesCollections = await db.listCollections({
        name: 'parties'
    }).toArray();
    if (partiesCollections.length == 0) {
        parties = await db.createCollection('parties');
        console.log('Created parties collection');
    } else {
        parties = db.collection('parties');
        console.log('Found parties collection');
    }
}

// Setup mongoDB
var parties;
init();

// Setup timesync
var timesyncServer = require('timesync/server');
app.use('/timesync', timesyncServer.requestHandler);
var START_OF_NEXT_SONG = undefined;

// Listen on sockets'
io.on('connection', function(client) {
    client.on('join', function(data) {
        if (START_OF_NEXT_SONG != undefined) {
            client.emit('getReady', {
                nextSong: START_OF_NEXT_SONG,
            });
        }
    });

    client.on('createParty', async function(data) {
        let newPartyId = Math.random().toString(36).substring(6);
        await parties.insertOne({
            'partyId': newPartyId,
            'name': data.name,
            'currentSong': '',
            'currentSongStartTime': 0,
            'nextSong': '',
            'nextSongStartTime': 0,
            'songs': [],
            'users': [],
        });

        client.emit('createdParty', {
            'newPartyId': newPartyId,
        });
    });

    client.on('joinParty', async function(data) {
        uuid = uuidv4();

        let songList = await parties.findAndModify({
            'partyId': req.query.partyId,
        }, [], {
            '$push': {
                'users': uuid
            }
        });

        client.emit('joinedParty', {
            'uuid': uuid,
            'party': songList.value,
        });
    });

    client.on('getNextSong', async function(data) {
        let nextSong = await parties.findOne({
            'partyId': req.query.partyId,
        }, {
            'fields': {
                'nextSong': 1,
                'nextSongStartTime': 1,
            },
        });

        client.emit('gotNextSong', nextSong.value);
    });

    client.on('addSong', async function(data) {
        let songList = await parties.findAndModify({
            'partyId': req.query.partyId,
            'songs.songId': {
                '$ne': req.query.songId
            },
        }, [], {
            '$push': {
                'songs': {
                    'songId': req.query.songId,
                    'userId': req.query.userId,
                    'voterIds': [],
                }
            },
        });

        if (songList.value) {
            client.emit('addedSong', {
                'success': true,
            });
        } else {
            client.emit('addedSong', {
                'success': false,
            });
        }
    });

    client.on('removeSong', async function(data) {
        let songList = await parties.findAndModify({
            'partyId': req.query.partyId,
            'songs.songId': req.query.songId,
            'songs.userId': req.query.userId,
        }, [], {
            '$pull': {
                'songs': {
                    'songId': req.query.songId,
                }
            },
        });

        if (songList.value) {
            client.emit('removedSong', {
                'success': true,
            });
        } else {
            client.emit('removedSong', {
                'success': false,
            });
        }
    });

    client.on('voteSong', async function(data) {
        let songList = await parties.findAndModify({
            'partyId': req.query.partyId,
            'songs': {
                '$elemMatch': {
                    '$and': [{
                        'songId': req.query.songId,
                    }, {
                        'voterIds': {
                            '$ne': req.query.userId,
                        },
                    }]
                },
            },
        }, [], {
            '$push': {
                'songs.$.voterIds': req.query.userId,
            },
        });

        if (songList.value) {
            client.emit('votedSong', {
                'success': true,
            });
        } else {
            client.emit('votedSong', {
                'success': false,
            });
        }
    });

    client.on('unvoteSong', async function(data) {
        let songList = await parties.findAndModify({
            'partyId': req.query.partyId,
            'songs': {
                '$elemMatch': {
                    '$and': [{
                        'songId': req.query.songId,
                    }, {
                        'voterIds': req.query.userId,
                    }]
                },
            },
        }, [], {
            '$pull': {
                'songs.$.voterIds': req.query.userId,
            },
        });

        if (songList.value) {
            client.emit('unvotedSong', {
                'success': true,
            });
        } else {
            client.emit('unvotedSong', {
                'success': false,
            });
        }
    });
});

// Testing 
app.get('/sync', function(req, res) {
    START_OF_NEXT_SONG = new Date().getTime() + 15000
    io.emit('getReady', {time: START_OF_NEXT_SONG})
    res.send(`30 seconds start now`)
});
app.use(express.static(path.join(__dirname, 'public')));

http.listen(30000);
