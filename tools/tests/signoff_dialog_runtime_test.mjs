import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = Object.fromEntries([
  'taSignoffDialog', 'taSignoffForm', 'taSignoffRating', 'taSignoffComment',
  'taSignoffError', 'taSignoffSave', 'taSignoffCancel', 'taSignoffStudent',
  'taSignoffTask', 'taSignoffRatingField', 'taSignoffRatingLabel',
  'taSignoffCommentLabel', 'taStudentName',
].map(id => [id, {}]));
const { taSignoffRating: rating, taSignoffForm: form, taSignoffDialog: dialog } = elements;
elements.taStudentName.textContent = 'Fixture Student';
elements.taSignoffComment.value = '';
rating.focus = () => {};
rating.replaceChildren = (...choices) => { rating.choices = choices; };
Object.defineProperty(rating, 'selectedIndex', {
  set: index => { rating.value = rating.choices[index].value; },
});
form.reset = () => {};
dialog.showModal = () => {};
dialog.close = () => dialog.onclose();

const context = vm.createContext({
  document: {
    getElementById: id => elements[id] ?? null,
    addEventListener() {},
  },
  Option: function (label, value) { Object.assign(this, { label, value }); },
});
vm.runInContext(fs.readFileSync('public/js/ta.js', 'utf8'), context);
const run = expression => vm.runInContext(expression, context);
run(`
  taState.selectedStudent = 17;
  taState.selectedCourse = '3';
  const policy = {options: [{id: '1', label: 'Satisfactory'}], rating_required: true};
  const select = {dataset: {categoryName: 'Fixture Category'}, closest: () => ({querySelector: () => ({textContent: 'Fixture Task'})})};
  const saved = [];
  saveProgress = (...args) => saved.push(args.at(-1));
  const first = confirmSignoff(select, 7, 17, 'completed', 'Pending', policy);
`);
assert.equal(elements.taSignoffStudent.textContent, 'Fixture Student');
assert.equal(elements.taSignoffTask.textContent, 'Fixture Category · Fixture Task');
assert.equal(rating.value, '');
await form.onsubmit({ preventDefault() {} });
assert.equal(run('saved.length'), 0);
assert.equal(elements.taSignoffError.textContent, 'Select a rating to complete this task.');
rating.value = '1';
await form.onsubmit({ preventDefault() {} });
await run('first');
assert.equal(run('saved[0].rating_option_id'), '1');
run("const next = confirmSignoff(select, 7, 17, 'completed', 'Pending', policy);");
assert.equal(rating.value, '', 'each completion requires a fresh choice, even for a single-option scale');
await form.onsubmit({ preventDefault() {} });
assert.equal(run('saved.length'), 1);
dialog.close();
await run('next');
console.log('Sign-off dialog labels, single-choice requirement and reset passed.');
