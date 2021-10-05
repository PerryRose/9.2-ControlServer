const mqtt = require('mqtt');
const client = mqtt.connect("mqtt://wbe99751.ap-southeast-1.emqx.cloud:15724", {
    username: 'perryrose',
    password: 'XyK9x8imaeU6dp2'
});
const axios = require('axios');

const baseTopic = '/sit-314-task92';
let schedules = [];

const restServerAddress = 'http://RESTLoadBalancer-1559106515.ap-southeast-2.elb.amazonaws.com:3000';

let accessToken;

client.on('connect', () => {
    console.log('[mqtt connected]');

    getAccessToken();

    // Subscribe to incoming topics
    client.subscribe(baseTopic + '/from/#');
    
});

async function getAccessToken() {
    const res = await axios.post(restServerAddress + '/auth', JSON.stringify({
        "email": 'p@erryro.se',
        "password": '123456'
    }), {
        headers: {
            "Content-type": "application/json"
        }
    });

    accessToken = res.data.accessToken;

    getSchedules();
}

client.on('message', async (topic, message) => {
    //console.log(`[Incoming]: Topic: ${topic} - Message: ${message}`);

    // Get Light Data for Physical Light
    if (topic.includes('/get-physical-light')) {
        getDataForPhysicalLight(message);
    }
    // State Change from Physical Light
    else if (topic.includes('/state')) {
        updateLightState(topic, message);
    }
    // Brightness Change from Physical Light
    else if (topic.includes('/brightness')) {
        updateLightBrightness(topic, message);
    }
    // Listen for changes from website
    else if (topic.includes('/from/website') && topic.includes('update-state')) {
        tellPhysicalLightToChangeState(message);
    }
    // Listen for Schedule Delete
    else if (topic.includes('/from/website/delete-schedule')) {
        console.log(`[#] A schedule was deleted (Id: ${message}). Updating array.`);
        // Get Schedule Id
        const scheduleId = String(message);
        // Remove Schedule from array
        const index = schedules.findIndex(schedule => schedule._id == scheduleId);
        schedules.splice(index, 1);
    }
    // Listen for New Schedule
    else if (topic.includes('/from/website/add-schedule')) {
        console.log('[#] A new schedule was created. Updating array.');
        // Get Schedule
        const schedule = JSON.parse(message);
        // Add Schedule
        schedules.push(schedule);
    }

});

async function getDataForPhysicalLight(message) {
    const lightId = String(message);
    const roomId = lightId.split('.')[0];

    console.log(`[#] Physical Light ${lightId} has requested its data from database`);

    // Tell REST API about this light
    const res = await axios.post(restServerAddress + '/get-physical-light', { roomId: roomId, lightId: lightId }, {
        headers: {
            "Content-type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    // If no error
    if (res.status !== 403) {
        // Tell Light it's ready
        const light = res.data;

        console.log(`[#] Returning data to Physical Light ${lightId}`);

        // Pass state
        client.publish(baseTopic + '/to/' + lightId + '/light-ready', JSON.stringify({
            ready: true,
            state: light.state,
            roomId: light.roomId
        }));
    }
    else {
        // Tell Light an error occured
        client.publish(baseTopic + '/to/' + lightId + '/light-ready', JSON.stringify({
            ready: false
        }));
    }
}

async function updateLightState(topic, message) {
    // Get Variables
    const lightId = String(topic).split('/')[3];
    const roomId = String(topic).split('/')[5]
    const newState = String(message);

    // Update Light's State with REST API
    const res = await axios.post(restServerAddress + '/update-light-state', { 
        roomId: roomId, 
        lightId: lightId, 
        newState: newState
    }, {
        headers: {
            "Content-type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    // If no error
    if (res.status !== 403) {
        // Tell Website via MQTT
        client.publish(baseTopic + '/to/' + 'website' + '/update-state', JSON.stringify({
            roomId: roomId,
            lightId: lightId,
            newState: newState
        }));

        console.log(`[#] Telling website to update Light ${lightId}'s state to ${newState}`);
    }
    else {
        // Tell Light there was an error
        client.publish(baseTopic + '/to/' + lightId + '/error', 'There was an error updating this light\'s state with the REST API');
    }
}

async function updateLightBrightness(topic, message) {
    // Get Variables
    const lightId = String(topic).split('/')[3];
    const roomId = String(topic).split('/')[5]
    const newBrightness = String(message);

    // Update Light's Brightness with REST API
    const res = await axios.post(restServerAddress + '/update-light-brightness', { 
        roomId: roomId, 
        lightId: lightId, 
        brightness: newBrightness
    }, {
        headers: {
            "Content-type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    // If no error
    if (res.status !== 403) {
        // Tell Website via MQTT
        client.publish(baseTopic + '/to/' + 'website' + '/update-brightness', JSON.stringify({
            roomId: roomId,
            lightId: lightId,
            brightness: newBrightness
        }));

        console.log(`[#] Telling website to update Light ${lightId}'s brightness to ${newBrightness}`);
    }
    else {
        // Tell Light there was an error
        client.publish(baseTopic + '/to/' + lightId + '/error', 'There was an error updating this light\'s brightness with the REST API');
    }
}

async function tellPhysicalLightToChangeState(message) {
    // Convert message to object
    const messageObj = JSON.parse(message);

    const lightId = messageObj.lightId;
    const newState = messageObj.newState;

    console.log(`[#] Website wants to change Light ${lightId}'s state to ${newState}.`);

    // Tell Physical Switch
    client.publish(baseTopic + '/to/' + lightId + '/update-state', newState);
}

async function tellPhysicalLightToChangeStateAndBrightness(lightId, newState, newBrightness) {
    console.log(`[#] Scheduler wants to change Light ${lightId}'s state to ${newState} with brightness of ${newBrightness}%.`);

    // Tell Physical Switch
    client.publish(baseTopic + '/to/' + lightId + '/update-state', newState);
    client.publish(baseTopic + '/to/' + lightId + '/update-brightness', newBrightness);
}

async function getSchedules() {
    // Get Schedules
    const res = await axios.get(restServerAddress + '/get-schedules', {
        headers: {
            "Content-type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    // Get data
    const schedulesArray = res.data;

    // Add schedules to array
    schedulesArray.forEach(schedule => {
        schedules.unshift(schedule);
    });

    if (schedules.length > 0) {
        console.log('[#] Retrieved Schedules');
    }
    else {
        console.log('[#] There are no Schedules');
    }

    beginScheduling();
}

function beginScheduling() {
    console.log('[#] Starting Scheduling');

    // Once every 10 seconds
    setInterval(() => {
        console.log(`[#] Checking if it\'s time to perform any Schedules`);

        // For each schedule
        schedules.forEach(async (schedule) => {

            // Get Current Time
            const date = new Date();
            const currentHour = date.getHours();
            const currentMinute = date.getMinutes();

            // Get Scheduling Time
            const scheduleHour = Number(schedule.startTime.split(':')[0]);
            const scheduleMinute = Number(schedule.startTime.split(':')[1]);

            // If Schedule begins now
            if (currentHour == scheduleHour && currentMinute == scheduleMinute) {

                console.log(`[#] It\'s time to perform Schedule ${schedule.name}`);
                console.log(`[#] -> For Room ${schedule.roomId},`);
                console.log(`[#] -> ${schedule.action} the lights,`);
                console.log(`[#] -> Set brightness to ${schedule.brightness}`);
                
                // Do Action
                const roomId = schedule.roomId;
                const action = schedule.action;
                const newState = action.split('Turn ')[1];
                const brightness = schedule.brightness;

                // Get Response
                const res = await axios.post(restServerAddress + '/get-room', { roomId: roomId }, {
                    headers: {
                        "Content-type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    }
                });

                // If no error
                if (res.status !== 403) {
                    console.log('Got room from API');
                    // Get Room
                    const room = res.data;

                    // For each Light
                    room.lights.forEach(async (light) => {
                        // Get Light Id
                        const lightId = light.id;

                        console.log(`For each light... Light Id: ${lightId}`);

                        // Tell REST API about change
                        await axios.post(restServerAddress + '/update-light-state', { 
                            roomId: roomId, 
                            lightId: lightId, 
                            newState: String(newState)
                        }, {
                            headers: {
                                "Content-type": "application/json",
                                "Authorization": `Bearer ${accessToken}`
                            }
                        });

                        await axios.post(restServerAddress + '/update-light-brightness', { 
                            roomId: roomId, 
                            lightId: lightId, 
                            brightness: Number(brightness)
                        }, {
                            headers: {
                                "Content-type": "application/json",
                                "Authorization": `Bearer ${accessToken}`
                            }
                        });

                        // Tell Physical Switch about update
                        tellPhysicalLightToChangeStateAndBrightness(lightId, newState, brightness);

                        // Tell Website about update
                        client.publish(baseTopic + '/to/' + 'website' + '/update-state', JSON.stringify({
                            roomId: roomId,
                            lightId: lightId,
                            newState: newState
                        }));

                        client.publish(baseTopic + '/to/' + 'website' + '/update-brightness', JSON.stringify({
                            roomId: roomId,
                            lightId: lightId,
                            brightness: brightness
                        }));
                    });
                }
                else {
                    console.log(`Error getting Room data for Room ${roomId}`);
                }     
            }
            else {
                console.log(`[#] It's not time: ${currentHour}:${currentMinute} != ${scheduleHour}:${scheduleMinute}`)
            }

        });
    }, 10000);
}