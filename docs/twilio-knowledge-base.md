# Twilio Products Knowledge Base

This document contains comprehensive information about Twilio's products, features, APIs, and use cases for the AI Phone Booth knowledge system.

---

## Core Communication APIs

### Twilio Programmable Messaging

**What it is:**
Twilio Programmable Messaging allows you to send and receive SMS, MMS, and WhatsApp messages programmatically through a simple REST API.

**Key Features:**
- Send SMS and MMS to 180+ countries
- Two-way messaging with message status tracking
- WhatsApp Business API integration
- Long codes, short codes, and toll-free numbers
- Message templates and personalization
- Delivery receipts and error handling
- Unicode support for international messages

**Use Cases:**
- Order confirmations and shipping notifications
- Two-factor authentication (2FA)
- Appointment reminders
- Marketing campaigns
- Customer support conversations
- Emergency alerts and notifications

**Pricing:**
Pay-as-you-go pricing varies by country. US SMS starts at $0.0079 per message. Volume discounts available.

---

### Twilio Programmable Voice

**What it is:**
Build voice calling applications with Twilio's Voice API. Make, receive, and control phone calls programmatically.

**Key Features:**
- Make and receive phone calls globally
- Text-to-Speech (TTS) in 30+ languages
- Speech recognition and voice input
- Call recording and transcription
- Call forwarding and conferencing
- SIP trunking and interconnect
- Interactive Voice Response (IVR) systems
- Real-time call controls

**Use Cases:**
- Click-to-call from websites
- Call centers and contact centers
- Automated appointment reminders
- Phone verification systems
- Conference calling platforms
- Emergency hotlines
- Voice surveys and polls

**Pricing:**
US inbound calls: $0.0085/min, outbound calls: $0.013/min. International rates vary by country.

---

### Twilio Video

**What it is:**
Add video calling capabilities to your applications with Twilio's programmable video platform.

**Key Features:**
- WebRTC-based video conferencing
- Group Rooms (up to 50 participants)
- Peer-to-peer video calls
- Screen sharing
- Recording and composition
- Adaptive bitrate and bandwidth management
- Network quality indicators
- Mobile SDKs (iOS, Android)
- Browser support (Chrome, Firefox, Safari)

**Use Cases:**
- Telehealth and telemedicine
- Remote education and tutoring
- Virtual events and webinars
- Customer support video calls
- Live streaming applications
- Video interviews and recruiting

**Pricing:**
Group Rooms: $0.004/participant/minute. Peer-to-peer: $0.0005/participant/minute. Recording and composition additional.

---

### Twilio Conversations API

**What it is:**
Unified messaging across SMS, WhatsApp, Chat, and more. Build omnichannel messaging experiences with a single API.

**Key Features:**
- Single conversation across multiple channels
- Persistent message history
- Media attachments (images, files)
- Typing indicators and read receipts
- User identity management
- Webhooks for real-time events
- Message search and filtering
- Push notifications

**Use Cases:**
- Customer support chat systems
- Team collaboration tools
- Multi-channel customer engagement
- Healthcare patient communication
- Sales and CRM integrations

**Pricing:**
Active users: $0.05/month. Messages: $0.0079 per message (varies by channel).

---

## Advanced Communication Products

### Twilio Flex

**What it is:**
Cloud-based contact center platform that can be customized to fit your business needs.

**Key Features:**
- Omnichannel routing (voice, SMS, chat, email)
- Real-time agent dashboard
- Supervisor tools and analytics
- CRM integrations (Salesforce, etc.)
- AI-powered insights
- Custom workflows and plugins
- Skills-based routing
- IVR and self-service options

**Use Cases:**
- Customer support contact centers
- Sales call centers
- Help desk operations
- Field service dispatch
- Order management centers

**Pricing:**
Starts at $150/user/month for Flex UI. Additional usage charges for voice, messaging, etc.

---

### Twilio SendGrid

**What it is:**
Email delivery platform for transactional and marketing emails. Acquired by Twilio in 2019.

**Key Features:**
- Reliable email delivery (99% deliverability)
- Email API and SMTP relay
- Email template builder
- Marketing Campaigns tool
- Email analytics and tracking
- Spam and reputation monitoring
- A/B testing
- List management and segmentation

**Use Cases:**
- Transactional emails (receipts, confirmations)
- Password resets and verification emails
- Marketing newsletters
- Welcome email sequences
- Product update announcements

**Pricing:**
Free tier: 100 emails/day. Essentials plan starts at $19.95/month for 50,000 emails.

---

### Twilio Verify

**What it is:**
Secure user authentication with SMS, Voice, Email, and TOTP-based verification.

**Key Features:**
- SMS and voice OTP (one-time passwords)
- Email verification
- TOTP authenticator app support
- Rate limiting and fraud prevention
- Customizable verification templates
- Automatic retry logic
- Global phone number support
- PSD2 and SCA compliant

**Use Cases:**
- Two-factor authentication (2FA)
- Phone number verification
- Account recovery
- Transaction verification
- Login security
- Password reset flows

**Pricing:**
Verification attempts: $0.05 per attempt (SMS/Voice). Email: $0.01 per attempt.

---

### Twilio Lookup

**What it is:**
Phone number intelligence API for validating, formatting, and enriching phone number data.

**Key Features:**
- Phone number validation
- Carrier information lookup
- Number type detection (mobile/landline/VoIP)
- Caller name (CNAM) lookup
- International number formatting
- Risk assessment scores
- SIM swap detection
- Line type intelligence

**Use Cases:**
- Contact data validation
- Fraud prevention
- User onboarding optimization
- Caller ID enhancement
- Marketing list cleaning

**Pricing:**
Basic lookup: $0.005 per lookup. Carrier lookup: $0.01. Advanced data packages available.

---

## Developer Tools & APIs

### Twilio Studio

**What it is:**
Visual drag-and-drop interface for building communication workflows without code.

**Key Features:**
- No-code workflow builder
- Pre-built templates
- IVR and messaging flows
- Integration with Twilio Functions
- Testing and debugging tools
- Version control
- REST API triggers
- Real-time execution logs

**Use Cases:**
- Customer support IVR systems
- Appointment reminder flows
- Survey and feedback collection
- Lead qualification workflows
- Order status automation

**Pricing:**
Included with Twilio account. Pay for underlying Twilio services used.

---

### Twilio Functions

**What it is:**
Serverless environment for running Node.js code in response to Twilio events.

**Key Features:**
- No server management required
- Event-driven execution
- Built-in Twilio helpers
- Environment variable support
- NPM package dependencies
- Private functions (no public URL)
- Automatic scaling
- Integrated logging

**Use Cases:**
- Webhook handlers
- Custom business logic
- API integrations
- Data transformations
- Authentication handlers

**Pricing:**
Included with Twilio account. 10,000 free invocations/month, then $0.0001 per invocation.

---

### Twilio CLI

**What it is:**
Command-line interface for managing Twilio resources and testing applications.

**Key Features:**
- Manage phone numbers and configurations
- Test webhooks locally with ngrok
- Deploy Twilio Functions and Assets
- View logs and debugging information
- Autocomplete and plugins
- Profile management for multiple accounts

**Use Cases:**
- Local development and testing
- CI/CD pipeline integration
- Account management automation
- Debugging production issues

**Pricing:**
Free tool, download from npm or brew.

---

## Twilio Segment

**What it is:**
Customer data platform (CDP) for collecting, cleaning, and activating customer data. Acquired by Twilio in 2020.

**Key Features:**
- Single API for all customer data
- 450+ pre-built integrations
- Data validation and schema enforcement
- Real-time data streaming
- Identity resolution
- Audience segmentation
- Privacy and compliance tools
- Warehouse and cloud storage sync

**Use Cases:**
- Customer 360 view creation
- Marketing personalization
- Product analytics
- Customer journey mapping
- Data warehouse population

**Pricing:**
Free tier available. Team plan starts at $120/month. Business and enterprise custom pricing.

---

## AI & Automation Products

### Twilio Autopilot (Legacy - Now Voice Intelligence)

**What it is:**
Conversational AI platform for building voice and chatbots.

**Note:** Being replaced by Voice Intelligence and other AI tools.

---

### Twilio Voice Intelligence

**What it is:**
AI-powered call analytics, transcription, and insights for voice calls.

**Key Features:**
- Real-time call transcription
- Sentiment analysis
- Topic detection and categorization
- PII (Personal Identifiable Information) redaction
- Custom vocabulary support
- Language detection (20+ languages)
- Speaker separation
- Search and analytics

**Use Cases:**
- Call center quality assurance
- Compliance monitoring
- Agent training and coaching
- Customer insights
- Call summarization

**Pricing:**
Custom enterprise pricing based on volume.

---

## Platform Features

### Elastic SIP Trunking

**What it is:**
Connect your existing phone system to Twilio's global carrier network.

**Key Features:**
- Replace traditional phone lines
- Global connectivity
- Instant scalability
- Built-in redundancy
- International calling
- Emergency services (E911)
- CNAM caller ID
- Number porting

**Use Cases:**
- Modernizing legacy PBX systems
- Cost reduction on phone bills
- Business continuity planning
- Remote work enablement

**Pricing:**
$1.25/channel/month. Voice usage charges additional.

---

### Twilio Interconnect

**What it is:**
Direct peering with Twilio's carrier network for high-volume, low-latency voice traffic.

**Key Features:**
- Direct SIP connectivity
- Lower latency and higher quality
- Volume discounts
- Dedicated support
- Custom routing
- Toll-free origination

**Use Cases:**
- High-volume call centers
- Large enterprises
- Contact center platforms
- UCaaS providers

**Pricing:**
Custom enterprise pricing based on volume and requirements.

---

### Super Network

**What it is:**
Twilio's global carrier network with intelligent routing and redundancy.

**Key Features:**
- 220+ carrier relationships
- Automatic failover and rerouting
- Real-time quality monitoring
- Geo-redundant infrastructure
- 99.95% uptime SLA
- Global reach (180+ countries)
- Premium carrier tier options

**Benefits:**
- Higher deliverability rates
- Lower latency
- Improved call quality
- Better SMS conversion rates

---

## Industry Solutions

### Twilio Healthcare

**Specialized solutions for healthcare providers:**

**HIPAA-Compliant Products:**
- Programmable SMS
- Programmable Voice
- Twilio Verify
- Twilio Video (with BAA)

**Use Cases:**
- Appointment reminders
- Telehealth video visits
- Lab results notifications
- Medication reminders
- Patient intake and registration

**Compliance:**
Business Associate Agreement (BAA) available for HIPAA compliance.

---

### Twilio for Financial Services

**Features:**
- PSD2 and SCA compliance
- PCI DSS Level 1 certified infrastructure
- Masked phone numbers for privacy
- Secure voice and messaging
- Transaction verification

**Use Cases:**
- Two-factor authentication
- Fraud alerts
- Transaction confirmations
- Account notifications
- Customer support

---

### Twilio for Marketing

**Products:**
- Messaging campaigns (SMS/MMS)
- SendGrid Email Marketing
- Segment CDP for personalization
- WhatsApp Business messaging

**Use Cases:**
- Promotional campaigns
- Customer engagement
- Lead nurturing
- Event invitations
- Loyalty programs

---

## Security & Compliance

### Security Features

- TLS encryption for data in transit
- AES-256 encryption for data at rest
- SOC 2 Type II certified
- ISO 27001 certified
- GDPR compliant
- CCPA compliant
- PCI DSS Level 1
- HIPAA eligible (with BAA)

### Trust Hub

**What it is:**
Centralized platform for managing compliance requirements.

**Features:**
- Business profile verification
- A2P 10DLC registration
- SHAKEN/STIR attestation
- Brand registration for messaging
- Regulatory compliance tracking

---

## API & SDK Information

### Supported Languages

Official SDKs and helper libraries:
- **Node.js** (npm: twilio)
- **Python** (pip: twilio)
- **Ruby** (gem: twilio-ruby)
- **PHP** (composer: twilio/sdk)
- **Java** (Maven: twilio)
- **C#/.NET** (NuGet: Twilio)
- **Go** (github.com/twilio/twilio-go)

### REST API

- Base URL: `https://api.twilio.com`
- Authentication: HTTP Basic Auth (Account SID + Auth Token)
- Format: JSON responses
- Rate limits: Varies by endpoint (typically 1000s of requests/second)

### Webhooks

- POST requests to your server
- TwiML responses for voice/messaging
- Signature validation for security
- Retry logic for failures
- Configurable timeout periods

---

## Pricing Overview

### Pricing Models

1. **Pay-as-you-go**: No contracts, pay for what you use
2. **Committed Use Discounts**: Volume discounts for high usage
3. **Enterprise Agreements**: Custom pricing for large deployments

### Free Trial

- New accounts get free trial credit ($15-$20)
- No credit card required to start
- Full API access during trial
- Upgrade anytime to remove trial limitations

### Cost Optimization Tips

- Use toll-free numbers for customer-initiated calls
- Leverage local numbers for regional presence
- Enable message concatenation for long SMS
- Use Conversations API for multi-channel efficiency
- Monitor usage with Twilio Console analytics

---

## Getting Started

### Quick Start Steps

1. **Sign up** at twilio.com/try-twilio
2. **Verify your phone number** for trial account
3. **Get your API credentials** (Account SID & Auth Token)
4. **Purchase a phone number** from Twilio Console
5. **Send your first message** using REST API or SDK
6. **Configure webhooks** for incoming messages/calls
7. **Upgrade your account** to remove trial restrictions

### Documentation Resources

- **Docs**: twilio.com/docs
- **API Reference**: twilio.com/docs/api
- **Quickstarts**: twilio.com/docs/quickstart
- **Tutorials**: twilio.com/docs/tutorials
- **Code Samples**: github.com/twilio-samples

### Support Channels

- **Help Center**: support.twilio.com
- **Community Forum**: twilio.com/community
- **Stack Overflow**: Tag: twilio
- **Premium Support**: Available with paid support plans
- **Phone Support**: Enterprise plans only

---

## Common Integration Patterns

### CRM Integrations

- **Salesforce**: Native Twilio integration
- **HubSpot**: Click-to-call and SMS from HubSpot
- **Zendesk**: Support tickets with voice/SMS
- **Microsoft Dynamics**: Voice and messaging integration

### Development Frameworks

- **React**: React Native SDK for mobile apps
- **Angular**: Web SDK for voice/video
- **Vue.js**: Compatible with JavaScript SDK
- **Flutter**: Community SDKs available
- **Electron**: Desktop app integrations

### Cloud Platforms

- **AWS**: Lambda functions with Twilio webhooks
- **Google Cloud**: Cloud Functions integration
- **Azure**: Azure Functions and Logic Apps
- **Heroku**: One-click Twilio add-on

---

## Use Case Examples

### E-commerce

**Order Notifications:**
- Order confirmation SMS
- Shipping updates
- Delivery notifications
- Return authorization codes

**Customer Service:**
- Live chat support
- Video product demos
- Order status IVR
- SMS customer support

### Education

**Student Engagement:**
- Class reminders
- Assignment deadlines
- Emergency notifications
- Parent-teacher communication

**Remote Learning:**
- Virtual classroom (Twilio Video)
- Attendance verification (Twilio Verify)
- Student support hotline

### Healthcare

**Patient Communication:**
- Appointment reminders
- Prescription refill alerts
- Lab results delivery
- Post-visit surveys

**Telehealth:**
- Video consultations (HIPAA-compliant)
- Secure messaging
- Remote patient monitoring alerts

### Rideshare & Delivery

**Driver-Customer Connection:**
- Masked phone numbers (Proxy)
- Real-time delivery updates
- Route optimization notifications
- Rating and feedback collection

---

## Frequently Asked Questions

### Can I port my existing phone numbers to Twilio?

Yes, Twilio supports number porting from most carriers. The process typically takes 7-14 business days for US numbers.

### Does Twilio support international messaging?

Yes, Twilio supports SMS to 180+ countries and WhatsApp messaging globally.

### How do I scale my Twilio application?

Twilio automatically scales with your usage. For enterprise needs, contact sales for dedicated infrastructure.

### Is Twilio HIPAA compliant?

Yes, certain Twilio products are HIPAA-eligible when used with a signed Business Associate Agreement (BAA).

### What's the difference between Conversations API and Programmable Messaging?

Conversations API provides omnichannel messaging with persistent history. Programmable Messaging is for single-channel SMS/MMS.

### Can I use Twilio for emergency services (911)?

Yes, but you must enable E911 for your voice numbers and register physical addresses for users.

### How does Twilio handle message delivery failures?

Twilio provides delivery receipts with error codes. Failed messages include detailed error information for troubleshooting.

### What's A2P 10DLC?

Application-to-Person 10-Digit Long Code - a registration system for business messaging in the US. Required for SMS campaigns.

---

## Competitive Advantages

### Why Choose Twilio?

1. **Most Comprehensive Platform**: Voice, messaging, video, email, and more in one platform
2. **Developer-First**: Easy-to-use APIs and extensive documentation
3. **Global Reach**: 180+ countries with local numbers available
4. **Reliability**: 99.95% uptime SLA with automatic failover
5. **Scalability**: Powers billions of interactions annually
6. **Flexibility**: From startups to Fortune 500 companies
7. **Innovation**: Continuous product updates and new features

### Companies Using Twilio

- Airbnb (guest-host communication)
- Lyft (driver-passenger connection)
- Uber (delivery and ride notifications)
- Netflix (account security)
- Shopify (merchant notifications)
- Reddit (2FA and notifications)
- Twitter (SMS and 2FA)

---

## Migration Guides

### From Nexmo/Vonage

- Similar REST API structure
- Number porting available
- Comparable pricing model
- SDK migration guides available

### From Plivo

- Direct API mapping available
- Webhook URL updates needed
- SIP trunk migration supported

### From Bandwidth

- Voice API compatibility
- Messaging migration straightforward
- Contact sales for bulk migration

---

## Glossary

**Account SID**: Your unique Twilio account identifier  
**Auth Token**: Secret key for API authentication  
**TwiML**: Twilio Markup Language for voice/messaging instructions  
**Webhook**: HTTP callback triggered by Twilio events  
**SIP**: Session Initiation Protocol for VoIP  
**E164**: International phone number format (+15551234567)  
**Short Code**: 5-6 digit number for high-volume messaging  
**Toll-Free**: 1-800/888/etc numbers with free inbound calling  
**A2P**: Application-to-Person messaging  
**P2P**: Person-to-Person messaging  
**MMS**: Multimedia Messaging Service (images/videos)  
**IVR**: Interactive Voice Response system  
**CNAM**: Caller Name identification  
**DID**: Direct Inward Dialing number  

---

## Version Information

**Last Updated**: June 2026  
**API Version**: 2010-04-01 (stable)  
**Knowledge Base Version**: 1.0

For the most up-to-date information, always refer to twilio.com/docs
