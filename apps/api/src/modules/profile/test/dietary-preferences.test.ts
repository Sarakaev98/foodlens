import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIETARY_PREFERENCES, normalizeDietaryPreferences, validateUserNutritionProfileFields, validateUserNutritionProfileInput, type UserNutritionProfileInput, type UserNutritionProfile } from '@foodlens/core';
import type { DatabaseClient, DbUserNutritionProfile } from '@foodlens/database';
import { ProfileRepository } from '../profile.repository';
import { ProfileService } from '../profile.service';
import { UserNutritionProfileInputPipe } from '../user-nutrition-profile-input.pipe';
import { toUserNutritionProfile } from '../user-nutrition-profile.mapper';
import { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
const input: UserNutritionProfileInput={goal:'eat_healthier',age:30,sex:'male',heightCm:175,weightKg:75,activityLevel:'moderate',dietaryPreferences:['none'],allergens:[],avoidedIngredients:[]};
const row=(dietaryPreferences:unknown):DbUserNutritionProfile=>({...input,id:'profile',userId:'user',dietaryPreferences,createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01')}) as DbUserNutritionProfile;
describe('Four dietary types and persisted profile compatibility',()=>{
 it('canonical enum contains exactly the four choices',()=>assert.deepEqual(DIETARY_PREFERENCES,['none','vegetarian','vegan','pescatarian']));
 for(const diet of DIETARY_PREFERENCES)it(`${diet} passes profile/onboarding validation`,()=>{
  const value={...input,dietaryPreferences:[diet]};assert.equal(validateUserNutritionProfileInput(value).ok,true);
  assert.deepEqual(validateUserNutritionProfileFields(value,['dietaryPreferences','allergens','avoidedIngredients']),[]);
 });
 for(const legacy of [['halal'],['other'],['halal','other']])it(`legacy ${legacy.join('/')} normalizes to none`,()=>{
  const result=validateUserNutritionProfileInput({...input,dietaryPreferences:legacy});
  assert.ok(result.ok);assert.deepEqual(result.value.dietaryPreferences,['none']);
  assert.deepEqual(toUserNutritionProfile(row(legacy)).dietaryPreferences,['none']);
 });
 it('a preserved restriction wins over legacy/neutral values; order is deterministic',()=>{
  assert.deepEqual(normalizeDietaryPreferences(['halal','vegan','vegetarian']),['vegan']);
  assert.deepEqual(normalizeDietaryPreferences(['none','pescatarian']),['pescatarian']);
  assert.deepEqual(normalizeDietaryPreferences([]),['none']);
  assert.deepEqual(normalizeDietaryPreferences(undefined),['none']);
 });
 it('new multiple selections and unknown enum members are rejected',()=>{
  for(const values of [['vegan','vegetarian'],['none','vegan'],['made_up'],['halal','made_up'],[]])assert.equal(validateUserNutritionProfileInput({...input,dietaryPreferences:values}).ok,false);
 });
 it('onboarding save, read and profile edit persist a single canonical choice',async()=>{
  let stored=row(['halal']);let saved:unknown;
  const db={userNutritionProfile:{findUnique:async()=>stored,upsert:async({update}:{update:UserNutritionProfileInput})=>{saved=update.dietaryPreferences;stored={...stored,...update} as DbUserNutritionProfile;return stored;}}} as unknown as DatabaseClient;
  const service=new ProfileService(new ProfileRepository(db)),pipe=new UserNutritionProfileInputPipe();
  assert.deepEqual((await service.getProfile('user')).dietaryPreferences,['none']);
  const first=await service.saveProfile('user',pipe.transform({...input,dietaryPreferences:['other']}));
  assert.deepEqual(first.dietaryPreferences,['none']);assert.deepEqual(saved,['none']);
  const edited=await service.saveProfile('user',pipe.transform({...input,dietaryPreferences:['vegan']}));
  assert.deepEqual(edited.dietaryPreferences,['vegan']);assert.deepEqual(saved,['vegan']);
 });
 it('Goal Match and Meal Plan receive canonical preferences even from a legacy repository/cache',async()=>{
  for(const legacy of [['halal'],['other'],['halal','pescatarian']]){
   const profile={...toUserNutritionProfile(row(['none'])),dietaryPreferences:legacy} as unknown as UserNutritionProfile;
   const profiles={findProfile:async()=>profile} as unknown as ProfileService;
   const plan=await new NutritionTargetsService(profiles).findPlanForUser('user');
   assert.deepEqual(plan!.dietaryPreferences,legacy.includes('pescatarian')?['pescatarian']:['none']);
  }
 });
});
