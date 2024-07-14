// @ts-nocheck

/* eslint-disable jsx-a11y/alt-text */
/* eslint-disable @next/next/no-img-element */
import 'server-only'

import {
  createAI,
  createStreamableUI,
  getMutableAIState,
  getAIState,
  createStreamableValue
} from 'ai/rsc'

import { BotCard, BotMessage } from '@/components/stocks'

import { nanoid, sleep } from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat } from '../types'
import { auth } from '@/auth'
import { CheckIcon, SpinnerIcon, CodeIcon, DebugIcon, SetupIcon, DocIcon } from '@/components/ui/icons'
import { format } from 'date-fns'
import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'
import { CodeSnippets } from '@/components/coding/code-snippets'
import { Technologies } from '@/components/coding/technologies'
import { ProjectStructure } from '@/components/coding/project-structure'
import { Debugging } from '@/components/coding/debugging'
import { SetupEnvironment } from '@/components/coding/setup-environment'
import { Documentation } from '@/components/coding/documentation'
import { rateLimit } from './ratelimit'

const genAI = new GoogleGenerativeAI(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
)

async function describeImage(imageBase64: string) {
  'use server'

  await rateLimit()

  const aiState = getMutableAIState()
  const spinnerStream = createStreamableUI(null)
  const messageStream = createStreamableUI(null)
  const uiStream = createStreamableUI()

  uiStream.update(
    <BotCard>
      <CodeIcon isLoading />
    </BotCard>
  )
  ;(async () => {
    try {
      let text = ''

      // attachment as video for demo purposes,
      // add your implementation here to support
      // video as input for prompts.
      if (imageBase64 === '') {
        await new Promise(resolve => setTimeout(resolve, 5000))

        text = `
      The books in this image are:

      1. The Little Prince by Antoine de Saint-Exupéry
      2. The Prophet by Kahlil Gibran
      3. Man's Search for Meaning by Viktor Frankl
      4. The Alchemist by Paulo Coelho
      5. The Kite Runner by Khaled Hosseini
      6. To Kill a Mockingbird by Harper Lee
      7. The Catcher in the Rye by J.D. Salinger
      8. The Great Gatsby by F. Scott Fitzgerald
      9. 1984 by George Orwell
      10. Animal Farm by George Orwell
      `
      } else {
        const imageData = imageBase64.split(',')[1]

        const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' })
        const prompt = 'List the books in this image.'
        const image = {
          inlineData: {
            data: imageData,
            mimeType: 'image/png'
          }
        }

        const result = await model.generateContent([prompt, image])
        text = result.response.text()
        console.log(text)
      }

      spinnerStream.done(null)
      messageStream.done(null)

      uiStream.done(
        <BotCard>
          <CodeIcon />
        </BotCard>
      )

      aiState.done({
        ...aiState.get(),
        interactions: [text]
      })
    } catch (e) {
      console.error(e)

      const error = new Error(
        'The AI got rate limited, please try again later.'
      )
      uiStream.error(error)
      spinnerStream.error(error)
      messageStream.error(error)
      aiState.done()
    }
  })()

  return {
    id: nanoid(),
    attachments: uiStream.value,
    spinner: spinnerStream.value,
    display: messageStream.value
  }
}

async function submitUserMessage(content: string) {
  'use server'

  await rateLimit()

  const aiState = getMutableAIState()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content: `${aiState.get().interactions.join('\n\n')}\n\n${content}`
      }
    ]
  })

  const history = aiState.get().messages.map(message => ({
    role: message.role,
    content: message.content
  }))
  // console.log(history)

  const textStream = createStreamableValue('')
  const spinnerStream = createStreamableUI(<SpinnerMessage />)
  const messageStream = createStreamableUI(null)
  const uiStream = createStreamableUI()

  ;(async () => {
    try {
      const result = await streamText({
        model: google('models/gemini-1.5-flash'),
        temperature: 0.5,
        tools: {
          suggestCodeSnippets: {
            description: "Provide code snippets based on the user's query.",
            parameters: z.object({
              language: z.string(),
              requirement: z.string().describe('Description of the code needed')
            })
          },
          listTechnologies: {
            description: 'List recommended technologies for a project.',
            parameters: z.object({
              projectType: z.string().describe('Type of project (e.g., web app, mobile app)')
            })
          },
          showProjectStructure: {
            description: 'Show a recommended project structure.',
            parameters: z.object({
              projectType: z.string(),
              language: z.string()
            })
          },
          assistWithDebugging: {
            description: 'Assist with debugging a piece of code.',
            parameters: z.object({
              code: z.string().describe('The code that needs debugging')
            })
          },
          assistWithSetup: {
            description: 'Help set up a development environment.',
            parameters: z.object({
              environment: z.string().describe('Description of the environment (e.g., Docker, Node.js)')
            })
          },
          provideDocumentation: {
            description: 'Provide documentation for a given topic.',
            parameters: z.object({
              topic: z.string().describe('The topic for which documentation is needed')
            })
          }
        },
        system: `\
      You are Alex, a master full stack software engineer. You call the user "Boss" and provide exceptional assistance with any technical or non-technical requests they have, specifically focused on software development.
  
      The date today is ${format(new Date(), 'd LLLL, yyyy')}. 
      The Boss's current location is San Francisco, CA. Please assist them with their software development queries.

      Here's the flow: 
        1. Understand the Boss's request (e.g., what type of code or project they need help with).
        2. Provide relevant recommendations or actions (e.g., suggest code snippets, project structures, or technologies to use).
        3. Assist with specific code or project needs (e.g., help with coding tasks, debugging, or setting up development environments).
        4. Follow up with additional support or questions (e.g., ensure the Boss is satisfied with the solution and offer further help if needed).
      `,
        messages: [...history]
      })

      let textContent = ''
      spinnerStream.done(null)

      for await (const delta of result.fullStream) {
        const { type } = delta

        if (type === 'text-delta') {
          const { textDelta } = delta

          textContent += textDelta
          messageStream.update(<BotMessage content={textContent} />)

          aiState.update({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: textContent
              }
            ]
          })
        } else if (type === 'tool-call') {
          const { toolName, args } = delta

          if (toolName === 'listTechnologies') {
            const { projectType, technologies } = args

            uiStream.update(
              <BotCard>
                <Technologies projectType={projectType} technologies={technologies} />
              </BotCard>
            )

            aiState.done({
              ...aiState.get(),
              interactions: [],
              messages: [
                ...aiState.get().messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: `Here are some recommended technologies for your ${projectType} project: ${technologies.join(', ')}.`,
                  display: {
                    name: 'listTechnologies',
                    props: {
                      projectType,
                      technologies
                    }
                  }
                }
              ]
            })
          } else if (toolName === 'suggestCodeSnippets') {
            const { language, snippets } = args

            uiStream.update(
              <BotCard>
                <CodeSnippets language={language} snippets={snippets} />
              </BotCard>
            )

            aiState.done({
              ...aiState.get(),
              interactions: [],
              messages: [
                ...aiState.get().messages,
                {
                  id: nanoid(),
                  role:
export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'assistant' ? (
          message.display?.name === 'listTechnologies' ? (
            <BotCard>
              <Technologies projectType={message.display.props.projectType} technologies={message.display.props.technologies} />
            </BotCard>
          ) : message.display?.name === 'suggestCodeSnippets' ? (
            <BotCard>
              <CodeSnippets language={message.display.props.language} snippets={message.display.props.snippets} />
            </BotCard>
          ) : message.display?.name === 'showProjectStructure' ? (
            <BotCard>
              <ProjectStructure projectType={message.display.props.projectType} language={message.display.props.language} />
            </BotCard>
          ) : message.display?.name === 'assistWithDebugging' ? (
            <BotCard>
              <Debugging code={message.display.props.code} />
            </BotCard>
          ) : message.display?.name === 'assistWithSetup' ? (
            <BotCard>
              <SetupEnvironment environment={message.display.props.environment} />
            </BotCard>
          ) : message.display?.name === 'provideDocumentation' ? (
            <BotCard>
              <Documentation topic={message.display.props.topic} />
            </BotCard>
          ) : message.content === 'The code has been successfully validated.' ? (
            <BotCard>
              <CheckIcon />
            </BotCard>
          ) : (
            <BotMessage content={message.content} />
          )
        ) : message.role === 'user' ? (
          <UserMessage showAvatar>{message.content}</UserMessage>
        ) : (
          <BotMessage content={message.content} />
        )
    }))
}
'assistant', content: Here are some code snippets in ${language} based on your requirement: ${snippets.join(', ')}., display: { name: 'suggestCodeSnippets', props: { language, snippets } } } ] }) } else if (toolName === 'showProjectStructure') { aiState.done({ ...aiState.get(), interactions: [], messages: [ ...aiState.get().messages, { id: nanoid(), role: 'assistant', content: Here is a recommended project structure for a ${args.projectType} project using ${args.language}., display: { name: 'showProjectStructure', props: args } } ] })uiStream.update(
          <BotCard>
            <ProjectStructure projectType={args.projectType} language={args.language} />
          </BotCard>
        )
      } else if (toolName === 'assistWithDebugging') {
        aiState.done({
          ...aiState.get(),
          interactions: [],
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `Let's debug the following code: ${args.code}`,
              display: {
                name: 'assistWithDebugging',
                props: args
              }
            }
          ]
        })

        uiStream.update(
          <BotCard>
            <Debugging code={args.code} />
          </BotCard>
        )
      } else if (toolName === 'assistWithSetup') {
        aiState.done({
          ...aiState.get(),
          interactions: [],
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `Let's set up your development environment: ${args.environment}`,
              display: {
                name: 'assistWithSetup',
                props: args
              }
            }
          ]
        })

        uiStream.update(
          <BotCard>
            <SetupEnvironment environment={args.environment} />
          </BotCard>
        )
      } else if (toolName === 'provideDocumentation') {
        aiState.done({
          ...aiState.get(),
          interactions: [],
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `Here is the documentation for ${args.topic}.`,
              display: {
                name: 'provideDocumentation',
                props: args
              }
            }
          ]
        })

        uiStream.update(
          <BotCard>
            <Documentation topic={args.topic} />
          </BotCard>
        )
      }
    }
  }

  uiStream.done()
  textStream.done()
  messageStream.done()
} catch (e) {
  console.error(e)

  const error = new Error(
    'The AI got rate limited, please try again later.'
  )
  uiStream.error(error)
  textStream.error(error)
  messageStream.error(error)
  aiState.done()
}})()return { id: nanoid(), attachments: uiStream.value, spinner: spinnerStream.value, display: messageStream.value } }export async function requestCode() { 'use server'const aiState = getMutableAIState()aiState.done({ ...aiState.get(), messages: [ ...aiState.get().messages, { role: 'assistant', content: "A code has been sent to the Boss's phone. They should enter it in the user interface to continue." } ] })const ui = createStreamableUI(    );(async () => { await sleep(2000) ui.done() })()return { status: 'requires_code', display: ui.value } }export async function validateCode() { 'use server'const aiState = getMutableAIState()const status = createStreamableValue('in_progress') const ui = createStreamableUI(      Please wait while we validate your code.   );(async () => { await sleep(2000)ui.done(
  <div className="flex flex-col items-center text-center justify-center gap-3 p-4 text-emerald-700">
    <CheckIcon />
    <div>Code Validated</div>
    <div className="text-sm text-zinc-600">
      You can now proceed with your request.
    </div>
  </div>
)

aiState.done({
  ...aiState.get(),
  messages: [
    ...aiState.get().messages.slice(0, -1),
    {
      role: 'assistant',
      content: 'The code has been successfully validated.'
    }
  ]
})

status.done('completed')})()return { status: status.value, display: ui.value } }export type Message = { role: 'user' | 'assistant' | 'system' | 'function' | 'data' | 'tool' content: string id?: string name?: string display?: { name: string props: Record<string, any> } }export type AIState = { chatId: string interactions?: string[] messages: Message[] }export type UIState = { id: string display: React.ReactNode spinner?: React.ReactNode attachments?: React.ReactNode }[]export const AI = createAI<AIState, UIState>({ actions: { submitUserMessage, requestCode, validateCode, describeImage }, initialUIState: [], initialAIState: { chatId: nanoid(), interactions: [], messages: [] }, unstable_onGetUIState: async () => { 'use server'const session = await auth()

if (session && session.user) {
  const aiState = getAIState()

  if (aiState) {
    const uiState = getUIStateFromAIState(aiState)
    return uiState
  }
} else {
  return
}}, unstable_onSetAIState: async ({ state }) => { 'use server'const session = await auth()

if (session && session.user) {
  const { chatId, messages } = state

  const createdAt = new Date()
  const userId = session.user.id as string
  const path = `/chat/${chatId}`
  const title = messages[0].content.substring(0, 100)

  const chat: Chat = {
    id: chatId,
    title,
    userId,
    createdAt,
    messages,
    path
  }

  await saveChat(chat)
} else {
  return
}} })export const getUIStateFromAIState = (aiState: Chat) => { return aiState.messages .filter(message => message.role !== 'system') .map((message, index) => ({ id: ${aiState.chatId}-${index}, display: message.role === 'assistant' ? ( message.display?.name === 'listTechnologies' ? (    ) : message.display?.name === 'suggestCodeSnippets' ? (    ) : message.display?.name === 'showProjectStructure' ? (    ) : message.display?.name === 'assistWithDebugging' ? (    ) : message.display?.name === 'assistWithSetup' ? (    ) : message.display?.name === 'provideDocumentation' ? (    ) : message.content === 'The code has been successfully validated.' ? (    ) : (  ) ) : message.role === 'user' ? ( {message.content} ) : (  ) })) }export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'assistant' ? (
          message.display?.name === 'listTechnologies' ? (
            <BotCard>
              <Technologies projectType={message.display.props.projectType} technologies={message.display.props.technologies} />
            </BotCard>
          ) : message.display?.name === 'suggestCodeSnippets' ? (
            <BotCard>
              <CodeSnippets language={message.display.props.language} snippets={message.display.props.snippets} />
            </BotCard>
          ) : message.display?.name === 'showProjectStructure' ? (
            <BotCard>
              <ProjectStructure projectType={message.display.props.projectType} language={message.display.props.language} />
            </BotCard>
          ) : message.display?.name === 'assistWithDebugging' ? (
            <BotCard>
              <Debugging code={message.display.props.code} />
            </BotCard>
          ) : message.display?.name === 'assistWithSetup' ? (
            <BotCard>
              <SetupEnvironment environment={message.display.props.environment} />
            </BotCard>
          ) : message.display?.name === 'provideDocumentation' ? (
            <BotCard>
              <Documentation topic={message.display.props.topic} />
            </BotCard>
          ) : message.content === 'The code has been successfully validated.' ? (
            <BotCard>
              <CheckIcon />
            </BotCard>
          ) : (
            <BotMessage content={message.content} />
          )
        ) : message.role === 'user' ? (
          <UserMessage showAvatar>{message.content}</UserMessage>
        ) : (
          <BotMessage content={message.content} />
        )
    }))
                                                }
