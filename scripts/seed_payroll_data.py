#!/usr/bin/env python3
"""
Seed script to populate zen-ops database with test payroll data
Usage: python3 seed_payroll_data.py
"""

import os
import sys
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.db.session import SessionLocal
from app.db.base import Base, engine
from app.models.user import User
from app.models.salary_structure import SalaryStructure
from app.models.payroll_policy import PayrollPolicy
from app.models.payroll_run import PayrollRun, PayrollRunStatus
from app.models.work_session import WorkSession
from app.models.enums import Role
from app.core.security import hash_password
from calendar import monthrange
import calendar


def seed_payroll_data():
    """Seed test payroll data"""
    session = SessionLocal()
    
    try:
        # 1. Create or get test users
        print("📦 Creating test users...")
        
        admin = session.query(User).filter_by(email="admin@zenops.local").first()
        if not admin:
            admin = User(
                email="admin@zenops.local",
                hashed_password=hash_password("admin123"),
                full_name="Admin User",
                is_active=True,
            )
            admin.roles = [Role.ADMIN]
            session.add(admin)
        
        finance = session.query(User).filter_by(email="finance@zenops.local").first()
        if not finance:
            finance = User(
                email="finance@zenops.local",
                hashed_password=hash_password("finance123"),
                full_name="Finance Manager",
                is_active=True,
            )
            finance.roles = [Role.FINANCE]
            session.add(finance)
        
        # Test employees
        emp1 = session.query(User).filter_by(email="emp1@zenops.local").first()
        if not emp1:
            emp1 = User(
                email="emp1@zenops.local",
                hashed_password=hash_password("emp123"),
                full_name="Raj Kumar",
                is_active=True,
            )
            emp1.roles = [Role.EMPLOYEE]
            session.add(emp1)
        
        emp2 = session.query(User).filter_by(email="emp2@zenops.local").first()
        if not emp2:
            emp2 = User(
                email="emp2@zenops.local",
                hashed_password=hash_password("emp123"),
                full_name="Priya Singh",
                is_active=True,
            )
            emp2.roles = [Role.EMPLOYEE]
            session.add(emp2)
        
        session.commit()
        print(f"✅ Created/updated users")
        
        # 2. Create payroll policy
        print("📋 Setting up payroll policy...")
        
        policy = session.query(PayrollPolicy).filter_by(is_active=True).first()
        if not policy:
            policy = PayrollPolicy(
                policy_name="Default Company Policy",
                is_active=True,
                monthly_pay_days=30,
                full_day_minimum_minutes=480,
                half_day_threshold_minutes=240,
                grace_period_minutes=15,
                lop_on_absent=True,
                lop_on_unapproved_leave=True,
                overtime_enabled=False,
                overtime_multiplier=1.5,
                overtime_requires_approval=True,
                pf_enabled_default=True,
                pf_employee_rate=12.0,
                pf_employer_rate=12.0,
                pf_wage_ceiling=15000.0,
                esi_enabled_default=False,
                esi_employee_rate=0.75,
                esi_employer_rate=3.25,
                pt_enabled_default=True,
                pt_monthly_amount=200.0,
                tds_enabled_default=True,
                weekly_off_day=6,  # Sunday
                annual_paid_leave_quota=21,
                company_holidays=[
                    {"date": "2026-01-26", "name": "Republic Day", "paid": True},
                    {"date": "2026-03-08", "name": "Maha Shivaratri", "paid": True},
                    {"date": "2026-03-29", "name": "Holi", "paid": True},
                    {"date": "2026-04-14", "name": "Dr. B.R. Ambedkar Jayanti", "paid": True},
                ]
            )
            session.add(policy)
            session.commit()
        print(f"✅ Created/updated payroll policy")
        
        # 3. Create salary structures
        print("💰 Creating salary structures...")
        
        # Salary structure for emp1 (₹50k/month)
        ss1 = session.query(SalaryStructure).filter_by(user_id=emp1.id).first()
        if not ss1:
            ss1 = SalaryStructure(
                user_id=emp1.id,
                effective_from=date(2026, 1, 1),
                monthly_ctc=60000.0,
                monthly_gross=50000.0,
                payroll_divisor_days=30,
                standard_minutes_per_day=480,
                overtime_multiplier=2.0,
                overtime_requires_approval=True,
                pf_enabled=True,
                esi_enabled=False,
                pt_enabled=True,
                tds_mode="MANUAL",
            )
            session.add(ss1)
        
        # Salary structure for emp2 (₹35k/month)
        ss2 = session.query(SalaryStructure).filter_by(user_id=emp2.id).first()
        if not ss2:
            ss2 = SalaryStructure(
                user_id=emp2.id,
                effective_from=date(2026, 1, 1),
                monthly_ctc=42000.0,
                monthly_gross=35000.0,
                payroll_divisor_days=30,
                standard_minutes_per_day=480,
                overtime_multiplier=2.0,
                overtime_requires_approval=True,
                pf_enabled=True,
                esi_enabled=False,
                pt_enabled=True,
                tds_mode="MANUAL",
            )
            session.add(ss2)
        
        session.commit()
        print(f"✅ Created salary structures")
        
        # 4. Create work sessions for Feb 2026
        print("📅 Creating work sessions for February 2026...")
        
        feb_start = date(2026, 2, 1)
        _, days_in_feb = monthrange(2026, 2)
        
        # Count existing sessions
        existing_count = session.query(WorkSession).filter(
            WorkSession.user_id.in_([emp1.id, emp2.id]),
            WorkSession.login_at >= datetime(2026, 2, 1),
            WorkSession.login_at < datetime(2026, 3, 1),
        ).count()
        
        if existing_count == 0:
            # Create 22 working days (exclude Sundays) for emp1
            working_days_created = 0
            for day_num in range(1, days_in_feb + 1):
                current_date = date(2026, 2, day_num)
                # Skip Sundays (weekday() returns 6 for Sunday)
                if current_date.weekday() == 6:
                    continue
                
                # Skip holidays
                holiday_dates = ["2026-02-26"]  # Only one in Feb, if any
                if current_date.isoformat() in holiday_dates:
                    continue
                
                # Create session: 08:00 to 17:00 (540 minutes = 9 hours)
                login_dt = datetime(2026, 2, day_num, 8, 0, 0)
                logout_dt = datetime(2026, 2, day_num, 17, 0, 0)
                
                ws1 = WorkSession(
                    user_id=emp1.id,
                    login_at=login_dt,
                    last_seen_at=logout_dt,
                    logout_at=logout_dt,
                    duration_minutes=540,
                    session_type="AUTO",
                )
                session.add(ws1)
                
                # emp2 works 20 days (more absences)
                if working_days_created < 20:
                    ws2 = WorkSession(
                        user_id=emp2.id,
                        login_at=login_dt,
                        last_seen_at=logout_dt,
                        logout_at=logout_dt,
                        duration_minutes=540,
                        session_type="AUTO",
                    )
                    session.add(ws2)
                
                working_days_created += 1
            
            session.commit()
            print(f"✅ Created work sessions")
        else:
            print(f"⏭️  Work sessions already exist (skipping)")
        
        # 5. Create payroll run
        print("🏭 Creating payroll run...")
        
        payroll_run = session.query(PayrollRun).filter_by(
            month="2026-02", year=2026
        ).first()
        
        if not payroll_run:
            payroll_run = PayrollRun(
                month="2026-02",
                year=2026,
                status=PayrollRunStatus.DRAFT,
                employee_count=0,
                total_gross=0.0,
                total_net=0.0,
                total_deductions=0.0,
            )
            session.add(payroll_run)
            session.commit()
            print(f"✅ Created payroll run (DRAFT status)")
        else:
            print(f"⏭️  Payroll run already exists")
        
        # Summary
        print("\n" + "=" * 60)
        print("✨ TEST DATA SEEDING COMPLETE")
        print("=" * 60)
        print(f"""
Admin User:     admin@zenops.local / admin123
Finance User:   finance@zenops.local / finance123

Test Employees:
  - Raj Kumar (emp1@zenops.local) - ₹50,000/month
  - Priya Singh (emp2@zenops.local) - ₹35,000/month

Payroll Run Created: February 2026 (DRAFT)
  - Ready to calculate payroll
  - Work sessions recorded for Feb 1-28 (excluding Sundays)

Next Steps:
  1. Login to http://localhost with finance@zenops.local
  2. Go to Admin > Payroll > Payroll Runs
  3. Click on Feb 2026 run
  4. Click "Calculate Payroll"
  5. Review attendance & salary breakdown
  6. Click "Approve"
  7. Click "Mark Paid"
  8. Export to CSV if needed
        """)
        
    except Exception as e:
        print(f"❌ Error seeding data: {e}")
        import traceback
        traceback.print_exc()
        session.rollback()
        return False
    finally:
        session.close()
    
    return True


if __name__ == "__main__":
    success = seed_payroll_data()
    sys.exit(0 if success else 1)
