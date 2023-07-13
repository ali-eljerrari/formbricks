"use server";

import { prisma } from "@formbricks/database";
import { ResourceNotFoundError } from "@formbricks/errors";
import { captureTelemetry } from "@formbricks/lib/telemetry";
import { Team } from "@prisma/client";
import { Prisma as prismaClient } from "@prisma/client/";


export async function createTeam(teamName: string, ownerUserId: string): Promise<Team> {
  const newTeam = await prisma.team.create({
    data: {
      name: teamName,
      memberships: {
        create: {
          user: { connect: { id: ownerUserId } },
          role: "owner",
          accepted: true,
        },
      },
      products: {
        create: [
          {
            name: "My Product",
            environments: {
              create: [
                {
                  type: "production",
                  eventClasses: {
                    create: [
                      {
                        name: "New Session",
                        description: "Gets fired when a new session is created",
                        type: "automatic",
                      },
                      {
                        name: "Exit Intent (Desktop)",
                        description: "A user on Desktop leaves the website with the cursor.",
                        type: "automatic",
                      },
                      {
                        name: "50% Scroll",
                        description: "A user scrolled 50% of the current page",
                        type: "automatic",
                      },
                    ],
                  },
                  attributeClasses: {
                    create: [
                      {
                        name: "userId",
                        description: "The internal ID of the person",
                        type: "automatic",
                      },
                      {
                        name: "email",
                        description: "The email of the person",
                        type: "automatic",
                      },
                    ],
                  },
                },
                {
                  type: "development",
                  eventClasses: {
                    create: [
                      {
                        name: "New Session",
                        description: "Gets fired when a new session is created",
                        type: "automatic",
                      },
                    ],
                  },
                  attributeClasses: {
                    create: [
                      {
                        name: "userId",
                        description: "The internal ID of the person",
                        type: "automatic",
                      },
                      {
                        name: "email",
                        description: "The email of the person",
                        type: "automatic",
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    include: {
      memberships: true,
    },
  });

  return newTeam;
}

export async function deleteSurveyAction(surveyId: string) {
  const deletedSurvey = await prisma.survey.delete({
    where: {
      id: surveyId,
    },
  });
  return deletedSurvey;
}

export async function createSurveyAction(environmentId: string, surveyBody: any) {
  const survey = await prisma.survey.create({
    data: {
      ...surveyBody,
      environment: {
        connect: {
          id: environmentId,
        },
      },
    },
  });
  captureTelemetry("survey created");

  return survey;
}

export async function duplicateSurveyAction(environmentId:string, surveyId:string){
  const existingSurvey = await prisma.survey.findFirst({
    where: {
      id: surveyId,
      environmentId,
    },
    include: {
      triggers: true,
      attributeFilters: true,
    },
  });

  if(!existingSurvey){
    throw new ResourceNotFoundError("Survey",surveyId)
  }
  // create new survey with the data of the existing survey
  const newSurvey = await prisma.survey.create({
    data: {
      ...existingSurvey,
      id: undefined, // id is auto-generated
      environmentId: undefined, // environmentId is set below
      name: `${existingSurvey.name} (copy)`,
      status: "draft",
      questions: JSON.parse(JSON.stringify(existingSurvey.questions)),
      thankYouCard: JSON.parse(JSON.stringify(existingSurvey.thankYouCard)),
      triggers: {
        create: existingSurvey.triggers.map((trigger) => ({
          eventClassId: trigger.eventClassId,
        })),
      },
      attributeFilters: {
        create: existingSurvey.attributeFilters.map((attributeFilter) => ({
          attributeClassId: attributeFilter.attributeClassId,
          condition: attributeFilter.condition,
          value: attributeFilter.value,
        })),
      },
      environment: {
        connect: {
          id: environmentId,
        },
      },
      surveyClosedMessage: existingSurvey.surveyClosedMessage ?? prismaClient.JsonNull,
    },
  });
  return newSurvey;
}

export async function copyToOtherEnvironmentAction(environmentId:string, surveyId:string, targetEnvironmentId:string){
  const existingSurvey = await prisma.survey.findFirst({
    where: {
      id: surveyId,
      environmentId,
    },
    include: {
      triggers: {
        include: {
          eventClass: true,
        },
      },
      attributeFilters: {
        include: {
          attributeClass: true,
        },
      },
    },
  });

  if (!existingSurvey) {
    throw new ResourceNotFoundError("Survey",surveyId)
  }

  let targetEnvironmentTriggers: string[] = [];
  // map the local triggers to the target environment
  for (const trigger of existingSurvey.triggers) {
    const targetEnvironmentTrigger = await prisma.eventClass.findFirst({
      where: {
        name: trigger.eventClass.name,
        environment: {
          id: targetEnvironmentId,
        },
      },
    });
    if (!targetEnvironmentTrigger) {
      // if the trigger does not exist in the target environment, create it
      const newTrigger = await prisma.eventClass.create({
        data: {
          name: trigger.eventClass.name,
          environment: {
            connect: {
              id: targetEnvironmentId,
            },
          },
          description: trigger.eventClass.description,
          type: trigger.eventClass.type,
          noCodeConfig: trigger.eventClass.noCodeConfig
            ? JSON.parse(JSON.stringify(trigger.eventClass.noCodeConfig))
            : undefined,
        },
      });
      targetEnvironmentTriggers.push(newTrigger.id);
    } else {
      targetEnvironmentTriggers.push(targetEnvironmentTrigger.id);
    }
  }

  let targetEnvironmentAttributeFilters: string[] = [];
  // map the local attributeFilters to the target env
  for (const attributeFilter of existingSurvey.attributeFilters) {
    // check if attributeClass exists in target env.
    // if not, create it
    const targetEnvironmentAttributeClass = await prisma.attributeClass.findFirst({
      where: {
        name: attributeFilter.attributeClass.name,
        environment: {
          id: targetEnvironmentId,
        },
      },
    });
    if (!targetEnvironmentAttributeClass) {
      const newAttributeClass = await prisma.attributeClass.create({
        data: {
          name: attributeFilter.attributeClass.name,
          description: attributeFilter.attributeClass.description,
          type: attributeFilter.attributeClass.type,
          environment: {
            connect: {
              id: targetEnvironmentId,
            },
          },
        },
      });
      targetEnvironmentAttributeFilters.push(newAttributeClass.id);
    } else {
      targetEnvironmentAttributeFilters.push(targetEnvironmentAttributeClass.id);
    }
  }

  // create new survey with the data of the existing survey
  const newSurvey = await prisma.survey.create({
    data: {
      ...existingSurvey,
      id: undefined, // id is auto-generated
      environmentId: undefined, // environmentId is set below
      name: `${existingSurvey.name} (copy)`,
      status: "draft",
      questions: JSON.parse(JSON.stringify(existingSurvey.questions)),
      thankYouCard: JSON.parse(JSON.stringify(existingSurvey.thankYouCard)),
      triggers: {
        create: targetEnvironmentTriggers.map((eventClassId) => ({
          eventClassId: eventClassId,
        })),
      },
      attributeFilters: {
        create: existingSurvey.attributeFilters.map((attributeFilter, idx) => ({
          attributeClassId: targetEnvironmentAttributeFilters[idx],
          condition: attributeFilter.condition,
          value: attributeFilter.value,
        })),
      },
      environment: {
        connect: {
          id: targetEnvironmentId,
        },
      },
      surveyClosedMessage: existingSurvey.surveyClosedMessage ?? prismaClient.JsonNull,
    },
  });
  return newSurvey;
}