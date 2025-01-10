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
				'http://ecoclaim.adriandecola.com',
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
const openai_meta_carbon = new OpenAI({
	organization: process.env.OPENAI_META_ORG,
	apiKey: process.env.OPENAI_API_KEY_META_ADRIANS,
});
// New way of authentication with project key for EcoClaim
// for debugging
const openai_ecoclaim = new OpenAI({
	organization: process.env.OPENAI_ECOCLAIM_ORGANIZATION_KEY,
	project: process.env.OPENAI_ECOCLAIM_PROJECT_KEY,
	apiKey: process.env.OPENAI_ECOCLAIM_ADRIANS_API_KEY,
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
		const completion = await openai_meta_carbon.chat.completions.create({
			messages: [
				{
					role: 'system',
					content:
						"You are a helpful assistant designed to identify and extract specific travel booking details from user messages. Your task is to analyze the text for certain keywords and phrases, and return the extracted values in JSON format. The key details to look for are: \
            travel type (which can be either 'round trip' or 'one-way'), \
            initial airport (IATA code if possible, city is fine), \
            final airport (IATA code if possible, city is fine), \
            number of passengers (as a number), \
            and flight class (options include 'economy', 'premium economy', 'business', or 'first class'). \
            Please return the values with the exact notations: 'travelType', 'initialAirport', 'finalAirport', 'numberOfPassengers', and 'flightClass'. \
            If any detail is not mentioned, return 'not specified' for that field. \
            Assume the discussion is about flights: given locations or cities are very likely the initial or final airports. \
            To emphasize: ALL location are referencing initial or final destinations/airports, be sure to include them in the response (converted to the correct IATA code if possible).",
				},
				{ role: 'user', content: userMessage },
			],
			model: 'gpt-4-0125-preview',
			response_format: { type: 'json_object' },
		});

		// Send data back
		const formInputs = completion.choices[0].message.content;
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
			const thread = await openai_meta_carbon.beta.threads.create();
			threadId = thread.id;
		}
		console.log('threadId: ', threadId);
		console.log('\n');

		// Adding the message
		const userMessageObject =
			await openai_meta_carbon.beta.threads.messages.create(threadId, {
				role: 'user',
				content: userMessage,
			});

		// Running the assistant on the thread
		let run = await openai_meta_carbon.beta.threads.runs.create(threadId, {
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
			run = await openai_meta_carbon.beta.threads.runs.retrieve(
				threadId,
				runId
			);

			// Checking if the run requires action (function call)
			if (
				run.status === 'requires_action' &&
				run.required_action.type === 'submit_tool_outputs'
			) {
				const toolCalls =
					run.required_action.submit_tool_outputs.tool_calls;
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
							console.error(
								`Function ${functionName} is not defined.`
							);
							output = 'Failure';
							break;
					}

					toolOutputs.push({
						tool_call_id: toolCall.id,
						output: output,
					});
				}

				// Submitting the tool call outputs
				run =
					await openai_meta_carbon.beta.threads.runs.submitToolOutputs(
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
		const threadMessages =
			await openai_meta_carbon.beta.threads.messages.list(threadId);
		console.log('Thread Message: ', threadMessages);
		console.log('\n');

		// Getting the most recent message ID
		const firstMessageId = threadMessages.body.first_id;
		console.log('Fist Message ID: ', firstMessageId);
		console.log('\n');

		// Getting the most recent message, which is the assistants response
		const assistantMessageObject =
			await openai_meta_carbon.beta.threads.messages.retrieve(
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

app.post('/ecoclaim_assistant', async (req, res) => {
	// Logging for debugging
	console.log('EcoClaim Assistant endpoint hit! ');

	// Destructuring the request body
	const userMessage = req.body.message;
	let threadId = req.body.threadId;

	try {
		////////////////////////////////////////////////////////
		// 1. If threadId is null: create a new, empty thread //
		////////////////////////////////////////////////////////
		if (!threadId) {
			threadId = await openai_ecoclaim.beta.threads.create().id;
		}
		// Logging for debugging
		console.log('threadId: ', threadId);
		console.log('\n');

		///////////////////////////////////////////////
		// 2. Add the new user message to the thread //
		///////////////////////////////////////////////
		const newThreadMessages =
			await openai_ecoclaim.beta.threads.messages.create(threadId, {
				role: 'user',
				content: userMessage,
			});

		///////////////////////////////////
		// 3. Run the thread you created //
		///////////////////////////////////
		const run = await openai_ecoclaim.beta.threads.runs.create(threadId, {
			assistant_id: process.env.OPENAI_ECOCLAIM_ASSISTANT_ID,
		});
		// Logging for debugging
		console.log('New run created:', run.id);

		//////////////////////////////////////////////////////////
		// 4. Polling the run to add tool outputs, if required, //
		//    until the run is complete or fails				//
		//////////////////////////////////////////////////////////
		let currentRun = run;
		const MAX_POLL_ATTEMPTS = 20;
		let attempt = 0;

		while (attempt < MAX_POLL_ATTEMPTS) {
			attempt++;
			// Retrieve latest run status
			currentRun = await openai_ecoclaim.beta.threads.runs.retrieve(
				threadId,
				currentRun.id
			);

			// If the run is completed or failed, break out of loop
			if (
				currentRun.status === 'completed' ||
				currentRun.status === 'failed'
			) {
				break;
			}

			// If the run requires tool outputs
			if (
				currentRun.status === 'requires_action' &&
				currentRun.required_action?.type === 'submit_tool_outputs'
			) {
				// The run object should tell us which tool calls are needed
				const toolCalls =
					currentRun.required_action.submit_tool_outputs
						?.tool_calls || [];

				// We'll build an array of outputs to submit (one for each tool call)
				const outputsToSubmit = [];

				for (const call of toolCalls) {
					// The function name
					const fnName = call.function.name;
					// The arguments are stored as a JSON string
					const fnArgsString = call.function.arguments;
					// Parse the JSON arguments
					const fnArgs = JSON.parse(fnArgsString || '{}');

					let fnResult;

					// For now, we only have "calculateCarbonEmissionsForAllCommonMaterials"
					if (
						fnName ===
						'calculate_carbon_emissions_for_all_common_materials'
					) {
						// Call our function
						fnResult =
							calculateCarbonEmissionsForAllCommonMaterials(
								fnArgs
							);
					} else {
						// If you add more functions in the future, handle them here
						fnResult = { error: `Unknown function: ${fnName}` };
					}

					// Prepare the output entry
					outputsToSubmit.push({
						tool_call_id: call.id,
						// Must be a string
						output: JSON.stringify(fnResult),
					});
				}

				// Submit the tool outputs
				const submittedRun =
					await openai_ecoclaim.beta.threads.runs.submitToolOutputs(
						threadId,
						currentRun.id,
						{
							tool_outputs: outputsToSubmit,
						}
					);

				// Update currentRun with the result from the submit step
				currentRun = submittedRun;
			}

			// If we haven’t completed or failed yet, wait and try again
			if (
				currentRun.status !== 'completed' &&
				currentRun.status !== 'failed'
			) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
			} else {
				break;
			}
		}

		////////////////////////////////////////////
		// 5. Retrieving the assistant's response //
		////////////////////////////////////////////
		// Initialize an assistantResponse variable
		let assistantResponse = 'No final assistant response found.';

		// If completed, let's fetch all messages and find the latest assistant message
		if (currentRun.status === 'completed') {
			// 5a. List messages in the thread
			const threadMessages =
				await openai_ecoclaim.beta.threads.messages.list(threadId);

			// 5b. The messages are returned in `threadMessages.data`.
			//     We'll look for the **last** message from the assistant.
			//     (Messages can be in chronological or reverse-chronological order
			//      depending on how the endpoint returns them — here we check from last to first.)
			const msgs = threadMessages.data;
			for (let i = msgs.length - 1; i >= 0; i--) {
				const msg = msgs[i];
				// Check the role
				if (msg.role === 'assistant') {
					// If content is structured, each content item has a `.text.value`.
					// We'll just grab the first chunk if it exists.
					if (
						msg.content &&
						msg.content.length > 0 &&
						msg.content[0].text
					) {
						assistantResponse = msg.content[0].text.value;
					}
					break;
				}
			}
		} else if (currentRun.status === 'failed') {
			assistantResponse = `Run failed: ${
				currentRun.last_error?.message || ''
			}`;
		} else {
			// If we exit the loop for another reason
			assistantResponse = `Run ended with status: ${currentRun.status}`;
		}

		/////////////////////////////////////////////////////////////
		// 6. Send the final response, including the assistant text //
		/////////////////////////////////////////////////////////////
		res.json({
			assistantResponse: assistantResponse,
			threadId: threadId,
			passedReqBodt: req.body,
		});
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
app.listen(port, '0.0.0.0', () => {
	console.log(`Server listening on port: ${port}`);
});

////////////////////////////////////////////////////////
/////////////////// Helper Functions ///////////////////
////////////////////////////////////////////////////////
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

////////////////////////////////// Helper Functions for Ecoclaim Endpoint ///////////////////////////////////
///////////////////////////// Beta polling function  ///////////////////////////////////////
/**
 * Poll the status of a run until it completes, fails (programatically times out), or requires tool outputs.
 *
 * @param {string} threadId     - The ID of the thread.
 * @param {string} runId        - The ID of the run to poll.
 * @param {object} openaiClient - The OpenAI client (e.g., openai_ecoclaim).
 * @param {number} maxAttempts  - Max number of polling attempts before timing out.
 * @param {number} intervalMs   - Milliseconds between polling attempts.
 * @returns {Promise<object>}   - Returns the updated run object.
 */
async function pollRunStatus(
	threadId,
	runId,
	openaiClient,
	maxAttempts = 10,
	intervalMs = 2000
) {
	let attempts = 0;
	while (attempts < maxAttempts) {
		attempts++;
		const run = await openaiClient.beta.threads.runs.retrieve(
			threadId,
			runId
		);

		// If run is completed, failed, or requires tool outputs, return immediately
		if (
			run.status === 'completed' ||
			run.status === 'failed' ||
			(run.status === 'requires_action' &&
				run.required_action?.type === 'submit_tool_outputs')
		) {
			return run;
		}

		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error(`Run polling timed out after ${maxAttempts} attempts.`);
}

///////////////////////////// Beta function for assistant to call ///////////////////////////////////////
// probably no need for either of those checks as the assistant should fill out all fields and only fields
// specified
function calculateCarbonEmissionsForAllCommonMaterials(materials) {
	// Emissions factors (kg CO₂ per kg of material)
	const emissionsFactors = {
		asphalt: 0.05, // Example: Asphalt generates 0.05 kg CO₂ per kg
		brick_block: 0.03, // Example: Brick/Block generates 0.03 kg CO₂ per kg
		cardboard: 0.02, // Example: Cardboard generates 0.02 kg CO₂ per kg
		concrete: 0.1, // Example: Concrete generates 0.1 kg CO₂ per kg
		drywall: 0.07, // Example: Drywall generates 0.07 kg CO₂ per kg
		glass: 0.2, // Example: Glass generates 0.2 kg CO₂ per kg
		landfill: 0.15, // Example: Landfill generates 0.15 kg CO₂ per kg
		metal: 0.5, // Example: Metal generates 0.5 kg CO₂ per kg
		plastic_hard: 0.4, // Example: Hard plastic generates 0.4 kg CO₂ per kg
		plastic_soft: 0.3, // Example: Soft plastic generates 0.3 kg CO₂ per kg
		wood: 0.01, // Example: Wood generates 0.01 kg CO₂ per kg
	};

	// Calculate emissions for each material
	const emissions = {};
	let totalEmissions = 0;

	for (const material in materials) {
		if (
			materials.hasOwnProperty(material) &&
			emissionsFactors[material] !== undefined
		) {
			// Calculate emissions for the current material
			emissions[material] =
				materials[material] * emissionsFactors[material];
			// Add to the overall total emissions
			totalEmissions += emissions[material];
		}
	}

	// Add the total emissions to the result
	emissions.total = totalEmissions;

	return emissions;
}
