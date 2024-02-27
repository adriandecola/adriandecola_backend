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
var corsOptions = {
  origin: function (origin, callback) {
    if (
      [
        'https://chat.adriandecola.com',
        'http://assistant.adriandecola.com',
      ].indexOf(origin) !== -1 ||
      !origin
    ) {
      console.log('Origin:', origin);
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200, // For legacy browser support
};
const corsOptionsAllAllowed = {
  origin: '*', // This allows all origins
  optionsSuccessStatus: 200, // For legacy browser support
};

/////// Middleware ///////
app.use(express.json());
app.use(cors(corsOptionsAllAllowed)); /////////////
///////////// Temporarily turned off CORs cuz it so annoying
/////////////

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
const assistantId = process.env.OPENAI_ASSISTANT_FLIGHT_ID;
console.log('AssitantId: ', assistantId);

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

// Route to hit for JSON form component grab requests
app.post('/form', async (req, res) => {
  console.log('Form endpoint hit');
  try {
    const userMessage = req.body.message;

    // chat completion
    const formInputs = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            "You are a helpful assistant designed to identify and extract specific travel booking details from user messages. Your task is to analyze the text for certain keywords and phrases, and return the extracted values in JSON format. The key details to look for are: \
            travel type (which can be either 'round trip' or 'one-way'), \
            initial airport (IATA code if possible), \
            final airport (IATA code if possible), \
            number of passengers (as a number), \
            and flight class (options include 'economy', 'premium economy', 'business', or 'first class'). \
            Please return the values with the exact notations: 'travelType', 'initialAirport', 'finalAirport', 'numberOfPassengers', and 'flightClass'. \
            If any detail is not mentioned, return 'not specified' for that field.",
        },
        { role: 'user', content: userMessage },
      ],
      model: 'gpt-4-0125-preview',
      response_format: { type: 'json_object' },
    });

    // Send data back
    console.log('Form Inputs: ', formInputs);
    res.json(formInputs);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// Route to hit for assistant requests
app.post('/assistant', async (req, res) => {
  console.log('Assistant endpoint hit! ');

  // To be filled with formData if assistant calls the correct function
  let formData = null;

  try {
    // Getting the passed over user message
    const userMessage = req.body.message;
    console.log('req.body.threadID: ', req.body.threadId);
    console.log('\n');

    // Getting threadId if one was created
    let threadId; //function scope
    if (req.body.threadId) {
      threadId = req.body.threadId;
    } else {
      // Creating a thread
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }
    console.log('threadId: ', threadId);
    console.log('\n');

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
    console.log('Running');
    // its a constant each time the endpoints hit
    const runId = run.id;

    let i = 0;
    // Waiting for run to complete
    while (run.status != 'completed') {
      console.log('Run still in progress, try: ', i);
      // Wait for two seconds using a Promise with setTimeout
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // Retrieving the run again
      run = await openai.beta.threads.runs.retrieve(threadId, runId);

      // Checking if the run requires action (function call)
      if (
        run.status === 'requires_action' &&
        run.required_action.type === 'submit_tool_outputs'
      ) {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        let toolOutputs = [];

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let output;

          switch (functionName) {
            case 'fillCompanyForm':
              let functionData = fillCompanyForm(args);
              output = functionData.successStatus;
              if (output === 'Success') {
                formData = functionData.formData;
              }
              break;
            case 'calculateCarbonFootprint':
              output = await calculateCarbonFootprint(args);
              break;
            default:
              console.error(`Function ${functionName} is not defined.`);
              output = 'Failure';
              break;
          }

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: output,
          });
        }

        // Submitting the tool call outputs
        run = await openai.beta.threads.runs.submitToolOutputs(
          threadId,
          run.id,
          {
            tool_outputs: toolOutputs,
          }
        );
      }
      // Incrementing for console.logging
      i = i++;
    }
    console.log('Run Completed');
    console.log('\n');

    // Retrieve the thread messages
    const threadMessages = await openai.beta.threads.messages.list(threadId);
    console.log('Thread Message: ', threadMessages);
    console.log('\n');

    // Getting the most recent message ID
    const firstMessageId = threadMessages.body.first_id;
    console.log('Fist Message ID: ', firstMessageId);
    console.log('\n');

    // Getting the most recent message, which is the assistants response
    const assistantMessageObject = await openai.beta.threads.messages.retrieve(
      threadId,
      firstMessageId
    );
    console.log('Assistant Message Object: ', assistantMessageObject);
    console.log('\n');

    // Getting the assistants text value response
    const assistantMessage = assistantMessageObject.content[0].text.value;
    console.log('Assistant Message: ', assistantMessage);
    console.log('\n\n');

    // Send back the assistant's response and threadId with form data if given
    if (formData) {
      console.log('Returning form data: ', formData);
      res.json({
        response: assistantMessage,
        threadId: threadId,
        formData: formData,
      });
    } else {
      res.json({ response: assistantMessage, threadId: threadId });
    }
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

/////////////////// Helper Functions ///////////////////
function fillCompanyForm(formData) {
  const { companyName, numEmployees } = formData;

  // Check if at least one of the specified fields is provided
  if (!companyName && !numEmployees) {
    console.log(
      "At least one of 'companyName' or 'numEmployees' must be provided."
    );
    return {
      successStatus: 'Failure',
      formData: null,
    };
  }

  // Log the provided information
  console.log(`Form Details:
  Company Name: ${companyName || 'null'},
  Number of Employees: ${numEmployees || 'null'}`);

  // Return the response with success status and the formData
  return {
    successStatus: 'Success',
    formData: {
      companyName: companyName || null,
      numEmployees: numEmployees || null,
    },
  };
}

function calculateCarbonFootprint(flightDistance, averagePassengers) {
  console.log('calculateCarbonFootprint function called');
  // Constants
  const fuelConsumptionPerKm = 0.03; // Example value, needs to be defined based on aircraft type and other factors
  const additionalKerosene = 1100; // 1.1 tons in kg
  const co2PerKgOfFuel = 3.1;

  // Calculate total kerosene needed
  let totalKerosene =
    flightDistance * fuelConsumptionPerKm + additionalKerosene;

  // Calculate total CO2 emissions
  let totalCO2Emissions = totalKerosene * co2PerKgOfFuel;

  // Calculate individual's CO2 contribution
  let individualContribution = totalCO2Emissions / averagePassengers;

  return individualContribution;
}
