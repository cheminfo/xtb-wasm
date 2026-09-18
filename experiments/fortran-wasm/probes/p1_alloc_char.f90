program p
  type :: t
    character(len=:), allocatable :: name
  end type
  type(t), allocatable :: b
  allocate(b)
  b%name = "hello"
  print *, "P1 OK ", b%name
end program
