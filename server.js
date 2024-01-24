// adriandecola_backend/server.js

import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

const app = express();
const port = 4000;

/////// Enviroment Variables config ///////
dotenv.config();

/////// CORS config ///////
// CORS config with dynamic origin check
var corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://chat.adriandecola.com',
      'http://assistant.adriandecola.com',
    ];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200, // For legacy browser support
};

/////// Middleware ///////
app.use(express.json());
app.use(cors(corsOptions));

/////// openai configs ///////
// used for personal website on digital oceans
const openai_personal = new OpenAI({
  organization: process.env.OPENAI_PERSONAL_ORG,
  apiKey: process.env.OPENAI_API_KEY_PERSONAL_DO_SERVER,
});
// used for Meta Carbon's assistant
const openai = new OpenAI({
  organization: process.env.OPENAI_META_ORG,
  apiKey: process.env.OPENAI_API_KEY_META_ADRIANS,
});
const assistantId = 'asst_GYlHGWVbAVRtJ0FxO8mo7uT2';

/////// Setting up a thread for the assistant ///////
/////// later I will put this in session for user and create it when ///////
/////// the /assistant endpoint is actually hit? ///////
/////// or when the page/plugin is loaded? ///////
let threadId; // global scope
try {
  const thread = await openai.beta.threads.create();
  threadId = thread.id;
} catch (err) {
  console.error(err);
}

/////////////////// Routes ///////////////////
// Route to hit for chat requests
app.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    // Get history from the request or initialize it
    const messageHistory = req.body.messageHistory || [];

    // Add the user's message to the history
    messageHistory.push({ role: 'user', content: userMessage });

    const stream = await openai_personal.chat.completions.create({
      model: 'ft:gpt-3.5-turbo-1106:personal::8XKVZmJ4',
      messages: messageHistory,
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Aggregates the assistant's response
    let assistantResponse = '';

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const part = chunk.choices[0].delta.content;
        assistantResponse += part;
        // Send a complete JSON object
        res.write(`data: ${JSON.stringify({ message: part })}\n\n`);
      }
    }

    // Add the complete assistant's response to the history
    messageHistory.push({
      role: 'assistant',
      content: assistantResponse.trim(),
    });

    // Ensure the history doesn't exceed 20 messages after adding the assistant's response
    while (messageHistory.length > 20) {
      messageHistory.shift();
    }

    // Send the full message history after the stream ends
    res.write(
      `data: ${JSON.stringify({ completeHistory: messageHistory })}\n\n`
    );
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// Route to hit for assistant requests
app.post('/assistant', async (req, res) => {
  console.log('Assistant endpoint hit! ');
  try {
    // Getting the passed over user message
    const userMessage = req.body.message;

    // Adding the message
    const userMessageObject = await openai.beta.threads.messages.create(
      threadId,
      {
        role: 'user',
        content: userMessage,
      }
    );

    // Running the assistant on the thread
    let run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });
    // its a constant each time the endpoints hit
    const runId = run.id;

    // Waiting for run to complete
    while (run.status != 'completed') {
      // Wait for three seconds using a Promise with setTimeout
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // Retrieving the run again
      run = await openai.beta.threads.runs.retrieve(threadId, runId);
    }

    // Retrieve the thread messages
    const threadMessages = await openai.beta.threads.messages.list(threadId);

    // Getting the most recent message ID
    const firstMessageId = threadMessages.body.first_id;

    // Getting the most recent message, which is the assistants response
    const assistantMessageObject = await openai.beta.threads.messages.retrieve(
      threadId,
      firstMessageId
    );

    // Getting the assistants text value response
    const assistantMessage = assistantMessageObject.content[0].text.value;

    // Send back the assistant's response
    res.json({ response: assistantMessage });
  } catch (error) {
    console.error('Error processing message: ', error);
    res.status(500).send('Server error');
  }
});

// Test route
app.post('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ message: 'Test response successful' });
});

// Starting the server
app.listen(port, 'localhost', () => {
  console.log(`Server listening on port: ${port}`);
});
