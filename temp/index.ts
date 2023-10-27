import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    // ... you will write your Prisma Client queries here
    const allUsers = await prisma.user.findMany();
    console.log(allUsers);
}

async function another() {
    await prisma.user.create({
        data: {
            name: "Alice",
            email: "alice@prisma.io",
            Post: {
                create: { title: "Hello World" },
            },
            Profile: {
                create: { bio: "I like turtles" },
            },
        },
    });
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
