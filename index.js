import Fastify from 'fastify';
import crypto from 'crypto';
import multiform from '@fastify/formbody';
import multipart from '@fastify/multipart';
import axios from 'axios';
import * as dotenv from 'dotenv'
import AsyncLock from 'async-lock';

dotenv.config();

// Require the framework and instantiate it
const fastify = Fastify({
    logger: false
})

import Database from 'better-sqlite3';
const db = new Database('chat.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL')

const lock = new AsyncLock();

fastify.register(multiform);
fastify.register(multipart, { addToBody: true });

//init table
const table = db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'chat';").get();
if (!table['count(*)']) {
    // If the table isn't there, create it and setup the database correctly.
    db.prepare("CREATE TABLE chat (hash TEXT PRIMARY KEY, timestamp INTEGER);").run();
    // Ensure that the "id" row is always unique and indexed.
    db.prepare("CREATE UNIQUE INDEX idx_chat_id ON chat (hash);").run();
    db.pragma("synchronous = 1");
    db.pragma("journal_mode = wal");
}

// setup prepared statements
const getChat = db.prepare("SELECT * FROM chat WHERE hash = ?");
const setChat = db.prepare("INSERT INTO chat (hash, timestamp) VALUES (@hash, @timestamp);");

// Declare a route
fastify.post('/webhook', async (request, reply) => {
    lock.acquire('lock', function() {
        console.log('lock aqcuired');

        let message;
        let hash;

        try {
            message = JSON.parse(request.body.data);
            const hashString = message.author + message.content + message.timestamp.toString().substring(0, message.timestamp.toString().length -2);
            hash = crypto.createHash('sha1').update(hashString).digest('base64');
        } catch(e) {
            console.log(e);
        }


        let chatExists = getChat.get(hash);
        if(chatExists) {
            return { dupe: 'true'};
        }

        const chatObject = {
            hash: hash,
            timestamp: message.timestamp
        };
        setChat.run(chatObject);

        let messageToSend;

        if (message.broadcast) {
            messageToSend = message.content;
        } else {
            messageToSend = `**${message.author}**: ${message.content}`

            messageToSend.replace('<img=0>', '<:Player_moderator_emblem:1082981033340833804>')
            messageToSend.replace('<img=2>', '<:Ironman_chat_badge:1082980848200065034>')
            messageToSend.replace('<img=3>', '<:Hardcore_group_ironman_chat_badg:1082981031315001344>')
            messageToSend.replace('<img=4>', '<:Ultimate_ironman_chat_badge:1082980849571602532>')
        }

        setTimeout(() => {
            axios.post(process.env.WEBHOOK_URL, {
                content: messageToSend
            }).then((res) => {
                return { dupe: 'false'}
            })
        }, 100);
    }, function(err, ret) {
        console.log('lock released');
    });
})

const start = async () => {
    try {
        await fastify.listen({port: process.env.APPLICATION_PORT, host: '0.0.0.0'})
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}
start()
