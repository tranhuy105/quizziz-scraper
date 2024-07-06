const puppeteer = require("puppeteer");
const fs = require("fs");
const QUIZZIZ_URL =
  "https://quizizz.com/join/quiz/64ba12becb79ee001dffa347/start?fbclid=IwAR1tAT1J4dp2RRhyIJZlcEpmeVshbOQuzT-8RUxc_vlEQ50ipv5MLd5P0SQ";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function indexToLetter(index) {
  if (index == "1") {
    return "A";
  } else if (index == "2") {
    return "B";
  } else if (index == "3") {
    return "C";
  } else if (index == "4") {
    return "D";
  } else {
    return "E";
  }
}

async function retry(action, retries = 3, waitTime = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await action();
    } catch (error) {
      console.log(
        `Retry ${i + 1}/${retries} failed: ${error.message}`
      );
      if (i < retries - 1) {
        await wait(waitTime);
      }
    }
  }
  throw new Error(`Action failed after ${retries} retries`);
}

async function getQuestionAndAnswers(page, retries = 10) {
  while (retries > 0) {
    console.log(
      "Try to take question and answer, try:",
      retries
    );
    const questionData = await page.evaluate(() => {
      try {
        // extract the question
        function extractQuestion() {
          const questionContainer = document.querySelector(
            ".question-text-color"
          );
          return questionContainer
            ? questionContainer.innerText.trim()
            : null;
        }

        // extract the answers
        function extractOptions() {
          const optionDivs = Array.from(
            document.querySelectorAll(".option.is-mcq")
          );
          const sortedOptions = optionDivs.sort((a, b) => {
            const aIndex =
              a.className.match(/option-(\d+)/)[1];
            const bIndex =
              b.className.match(/option-(\d+)/)[1];
            return aIndex - bIndex;
          });

          return sortedOptions.map((div) => ({
            option: div
              .querySelector(".resizeable")
              .innerText.trim(),
            id: div.getAttribute("data-cy"),
          }));
        }

        const question = extractQuestion();
        const options = extractOptions();

        if (question && options.length > 0) {
          return { question, options };
        } else {
          throw new Error("Questions or answers not found");
        }
      } catch (error) {
        return null;
      }
    });

    if (questionData) {
      return questionData;
    }

    retries--;
    await wait(3000);
  }

  throw new Error(
    "Question or answers not found after 12 retries."
  );
}

// Function to extract the correct answer
async function getCorrectAnswer(page) {
  return await retry(async () => {
    const correctAnswerElement = await page.$(
      ".is-correct"
    );
    if (correctAnswerElement) {
      const correctClass =
        await correctAnswerElement.evaluate(
          (el) => el.className.match(/option-(\d+)/)[0]
        );
      const correctIndex =
        correctClass.match(/option-(\d+)/)[1];
      return indexToLetter(correctIndex);
    } else {
      console.log(
        "Correct answer element not found, retrying..."
      );
      throw new Error("Correct answer element not found");
    }
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
  });
  const page = await browser.newPage();
  await page.goto(QUIZZIZ_URL, {
    waitUntil: "networkidle2",
  });

  await wait(5000);
  // Click the Start button
  await page.click('button[data-cy="start-solo-game"]');
  console.log("Clicked on the start solo game button");

  const quizData = [];

  await wait(6000); // Wait for the quiz to load

  while (true) {
    try {
      // Extract the question and options with the retry mechanism
      const questionData = await retry(() =>
        getQuestionAndAnswers(page)
      );

      // Check if the first option is available
      const firstOptionSelector = ".option-1";
      await retry(async () => {
        const firstOption = await page.$(
          firstOptionSelector
        );
        if (firstOption) {
          // Click on the first available option to reveal the answer
          await wait(3000);
          await firstOption.click();
          console.log("Clicked the first option");

          // Extract the correct answer
          const correctAnswer = await getCorrectAnswer(
            page
          );

          // Store the result
          quizData.push({
            question: questionData.question,
            options: questionData.options
              .map((o) => o.option)
              .join("\n"),
            answer: correctAnswer,
          });

          await wait(3000);
          const nextButtonClicked =
            await clickTheNextButton(page);
          if (!nextButtonClicked) {
            console.log(
              "Next button not found, continuing with next question..."
            );
          }
          const selectorsContainerClicked =
            await checkAndClickSelectorsContainer(page);
          if (!selectorsContainerClicked) {
            console.log(
              "Selectors container not found, continuing with next question..."
            );
          }
        } else {
          console.log(
            "First option not found, retrying..."
          );
          throw new Error("First option not found");
        }
      });
    } catch (error) {
      console.error("Error extracting quiz data:", error);
      break;
    }
  }

  await browser.close();

  // Formatting data for CSV
  const csvContent = quizData
    .map(({ question, options, answer }) => {
      return `"${question}\n${options}","${answer}"`;
    })
    .join("\n");

  // Writing data to CSV
  fs.writeFileSync("quiz_data.csv", csvContent);
  console.log("Quiz data saved to quiz_data.csv");
})();

const clickTheNextButton = async (page) => {
  try {
    await retry(async () => {
      const nextButtonElement = await page.$(
        ".right-navigator"
      );
      if (nextButtonElement) {
        await nextButtonElement.click();
        console.log("Clicked the next button");
        return true;
      }

      console.log("Next button not found, retrying...");
      throw new Error("Next button not found");
    });
    return true;
  } catch (error) {
    console.error(
      "Failed to click the next button after 3 retries:",
      error
    );
    return false;
  }
};

const checkAndClickSelectorsContainer = async (page) => {
  try {
    await retry(async () => {
      const selectorsContainer = await page.$(
        '.selectors-container[role="group"]'
      );
      if (selectorsContainer) {
        console.log("Selectors container found");
        const options = await selectorsContainer.$$(
          "button.selector-item"
        );
        if (options.length > 0) {
          await options[0].click(); // Click the first available option
          console.log(
            "Clicked an option within the selectors container"
          );
          await wait(3000);
          return true;
        } else {
          console.log(
            "No options found within the selectors container, retrying..."
          );
          throw new Error(
            "No options found within the selectors container"
          );
        }
      } else {
        console.log(
          "Selectors container not found, retrying..."
        );
        throw new Error("Selectors container not found");
      }
    });
    return true;
  } catch (error) {
    console.error(
      "Failed to click the selectors container after 3 retries:",
      error
    );
    return false;
  }
};
