import { describe, expect, it } from 'vitest';
import { guidePhotoUrls } from './guide-photos';
describe('guide photo sets', () => {
 it('supports old cover-only entries and keeps all distinct photos', () => {
  expect(guidePhotoUrls({image:'cover.jpg'})).toEqual(['cover.jpg']);
  expect(guidePhotoUrls({image:'cover.jpg',photos:['two.jpg','cover.jpg','']},['three.jpg','two.jpg'])).toEqual(['cover.jpg','two.jpg','three.jpg']);
  expect(guidePhotoUrls({image:'',photos:Array.from({length:80},(_,i)=>`${i}.jpg`)})).toHaveLength(80);
 });
 it('ignores malformed stored photo values', () => {
  expect(guidePhotoUrls({image:'',photos:[null,12,' valid.jpg '] as any})).toEqual(['valid.jpg']);
 });
});
